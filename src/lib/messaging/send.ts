import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { conversations, messages, phoneNumbers } from '@/lib/db/schema'
import { getProvider } from './index'
import { isOptedOut } from './opt-out'

// ── Environment guards ────────────────────────────────────────────────────────
//
// SMS_LIVE_MODE=true   → real Telnyx calls are made (production behaviour)
// DRY_RUN=true         → logs intended sends to console, writes a queued message
//                        row so you can inspect what would have gone out, but
//                        never calls the SMS provider
//
// If neither flag is set (e.g. local dev), sends are blocked and logged.
// Set SMS_LIVE_MODE=true in production and staging environments only.

const SMS_LIVE_MODE = process.env.SMS_LIVE_MODE === 'true'
const DRY_RUN = process.env.DRY_RUN === 'true'

// Default cooldown between workflow completions for the same lead + workflow
export const DEFAULT_COOLDOWN_DAYS = Number(process.env.WORKFLOW_COOLDOWN_DAYS ?? 30)

interface SendParams {
  tenantId: string
  leadId: string
  to: string            // lead phone E.164
  body: string
  workflowStepId?: string
  stepExecutionId?: string  // used for per-execution idempotency (automation sends only)
}

interface SendOutcome {
  messageId: string
  skipped?: 'opted_out' | 'sms_not_live'
  dryRun?: boolean
}

// ── Skipped-send record helper ────────────────────────────────────────────────
//
// Creates a message row (status=queued, skipReason set) so the audit trail
// shows what would have gone out even when the send was blocked.
// Returns the new message id, or null if we couldn't upsert the conversation.

async function writeSkippedMessageRow(p: {
  tenantId: string
  leadId: string
  to: string
  body: string
  workflowStepId?: string
  stepExecutionId?: string
  skipReason: string
}): Promise<string | null> {
  try {
    const phoneNumber = await db.query.phoneNumbers.findFirst({
      where: eq(phoneNumbers.tenantId, p.tenantId),
    })
    if (!phoneNumber) return null

    const [conversation] = await db
      .insert(conversations)
      .values({ tenantId: p.tenantId, leadId: p.leadId, tenantPhone: phoneNumber.number, leadPhone: p.to })
      .onConflictDoUpdate({ target: conversations.leadId, set: { updatedAt: new Date() } })
      .returning()

    const inserted = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        direction: 'outbound',
        body: p.body,
        status: 'queued',
        workflowStepId: p.workflowStepId ?? null,
        stepExecutionId: p.stepExecutionId ?? null,
        skipReason: p.skipReason,
        skippedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning()

    return inserted[0]?.id ?? null
  } catch {
    // Non-fatal — the caller will still return the skip outcome
    return null
  }
}

export async function sendMessage(params: SendParams): Promise<SendOutcome> {
  const { tenantId, leadId, to, body, workflowStepId, stepExecutionId } = params

  // ── Hard stop: never send to opted-out numbers ────────────────────────────
  if (await isOptedOut(tenantId, to)) {
    return { messageId: '', skipped: 'opted_out' }
  }

  // ── Environment gate: block sends unless explicitly enabled ───────────────
  if (!SMS_LIVE_MODE && !DRY_RUN) {
    console.warn(
      `[messaging/send] BLOCKED — SMS_LIVE_MODE is not enabled. ` +
      `Set SMS_LIVE_MODE=true to send real messages, or DRY_RUN=true to log intended sends. ` +
      `Would have sent to ${to}: "${body.slice(0, 60)}..."`
    )
    // Record the blocked send so the audit trail shows what would have gone out
    const blocked = await writeSkippedMessageRow({
      tenantId, leadId, to, body, workflowStepId, stepExecutionId, skipReason: 'sms_not_live',
    })
    return { messageId: blocked ?? '', skipped: 'sms_not_live' }
  }

  // ── Dry-run mode: record the intent but don't call Telnyx ─────────────────
  if (DRY_RUN) {
    console.log(
      `[messaging/send] DRY RUN — stepExecId=${stepExecutionId ?? 'manual'} ` +
      `to=${to} body="${body.slice(0, 80)}"`
    )
    const dryRunMsg = await writeSkippedMessageRow({
      tenantId, leadId, to, body, workflowStepId, stepExecutionId, skipReason: 'dry_run',
    })
    return { messageId: dryRunMsg ?? 'dry-run', dryRun: true }
  }

  // ── Idempotency check: skip if this step execution already sent ───────────
  // The unique index on messages.step_execution_id enforces this at the DB
  // level too, but checking here avoids a needless provider call on retry.
  if (stepExecutionId) {
    const existing = await db.query.messages.findFirst({
      where: eq(messages.stepExecutionId, stepExecutionId),
    })
    if (existing) {
      console.warn(
        `[messaging/send] Idempotency hit — stepExecutionId ${stepExecutionId} ` +
        `already produced message ${existing.id}. Skipping duplicate send.`
      )
      return { messageId: existing.id }
    }
  }

  // ── Get the active phone number for this tenant ───────────────────────────
  const phoneNumber = await db.query.phoneNumbers.findFirst({
    where: eq(phoneNumbers.tenantId, tenantId),
  })
  if (!phoneNumber) throw new Error(`No active phone number for tenant ${tenantId}`)

  // ── Upsert conversation ───────────────────────────────────────────────────
  // The unique constraint on conversations.leadId makes concurrent sends safe.
  const [conversation] = await db
    .insert(conversations)
    .values({ tenantId, leadId, tenantPhone: phoneNumber.number, leadPhone: to })
    .onConflictDoUpdate({
      target: conversations.leadId,
      set: { updatedAt: new Date() },
    })
    .returning()

  // ── Insert message row (status=queued) ────────────────────────────────────
  // stepExecutionId has a unique index → duplicate step fires will conflict and
  // the second insert will be ignored (onConflictDoNothing).
  const inserted = await db
    .insert(messages)
    .values({
      conversationId: conversation.id,
      direction: 'outbound',
      body,
      status: 'queued',
      workflowStepId: workflowStepId ?? null,
      stepExecutionId: stepExecutionId ?? null,
    })
    .onConflictDoNothing()
    .returning()

  // If conflict was hit (step already executed), return the existing message
  if (!inserted.length) {
    const existing = await db.query.messages.findFirst({
      where: eq(messages.stepExecutionId, stepExecutionId!),
    })
    return { messageId: existing!.id }
  }

  const message = inserted[0]

  // ── Send via provider ─────────────────────────────────────────────────────
  try {
    const provider = getProvider()
    const result = await provider.send({ to, from: phoneNumber.number, body })

    await db
      .update(messages)
      .set({ providerMessageId: result.providerMessageId, status: 'sent', sentAt: new Date() })
      .where(eq(messages.id, message.id))

    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversation.id))

    return { messageId: message.id }
  } catch (err) {
    console.error(`[messaging/send] Failed to send message ${message.id}:`, err)
    await db
      .update(messages)
      .set({ status: 'failed' })
      .where(eq(messages.id, message.id))
    throw err
  }
}
