/**
 * Outreach send orchestration — the single guarded path for every outreach
 * email. Server-only. Callers (server actions) MUST have already run
 * assertBrian(); these functions take the resolved actor and re-enforce the
 * product rules so a guard can't be skipped:
 *
 *   • test sends   → only ever to brian@dlr-sms.com, never gated by the toggle
 *   • real sends   → require OUTREACH_SEND_ENABLED=true AND full eligibility
 *                    AND not suppressed AND no status='sent' within 30 days
 *                    (re-queried here, not trusted from nextEligibleAt)
 *   • batch sends  → capped at OUTREACH_MAX_BATCH_SIZE (default 25)
 *
 * Every attempt writes an append-only outreach_sends row with an accurate
 * status (sent | test_sent | dry_run | skipped | failed) and reason.
 */

import 'server-only'
import { and, desc, eq, gte, inArray, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dealerProspects, outreachSends, outreachSuppressions } from '@/lib/db/schema'
import { trackEvent } from '@/lib/activity/track'
import { BRIAN_EMAIL } from '@/lib/admin/access'
import { getTemplateByKey, renderTemplate } from './templates'
import { sendOutreachEmail, outreachFromEmail } from './email'
import {
  cooldownStart,
  evaluateEligibility,
  maxBatchSize,
  nextEligibleFrom,
  normalizeEmail,
  sendEnabled,
} from './eligibility'

type Prospect = typeof dealerProspects.$inferSelect
type Actor = { id: string; email: string }

const DEFAULT_TEMPLATE_KEY = 'what_is_dlr'

// ── Suppression ──────────────────────────────────────────────────────────────

function domainOf(email: string): string {
  const at = email.lastIndexOf('@')
  return at >= 0 ? email.slice(at + 1).toLowerCase() : ''
}

/** True if this email or its domain is on the outreach suppression list. */
export async function isSuppressed(email: string): Promise<boolean> {
  const e = normalizeEmail(email)
  if (!e) return false
  const domain = domainOf(e)
  const rows = await db
    .select({ id: outreachSuppressions.id })
    .from(outreachSuppressions)
    .where(
      or(
        eq(outreachSuppressions.email, e),
        domain ? eq(outreachSuppressions.domain, domain) : undefined,
      ),
    )
    .limit(1)
  return rows.length > 0
}

// ── Cooldown (authoritative send-log check) ─────────────────────────────────

/** True if a real send (status='sent') went to this prospect within 30 days. */
async function sentWithinCooldown(prospectId: string, now: Date): Promise<boolean> {
  const rows = await db
    .select({ id: outreachSends.id })
    .from(outreachSends)
    .where(
      and(
        eq(outreachSends.prospectId, prospectId),
        eq(outreachSends.status, 'sent'),
        gte(outreachSends.createdAt, cooldownStart(now)),
      ),
    )
    .limit(1)
  return rows.length > 0
}

// ── Result types ─────────────────────────────────────────────────────────────

export type SendOutcome =
  | { ok: true; kind: 'sent' | 'test_sent'; providerMessageId: string | null }
  | { ok: false; kind: 'skipped' | 'dry_run' | 'failed'; reason: string; detail?: string }

// ── Test send (always to Brian, never gated by the toggle) ──────────────────

export async function sendTestToBrian(
  prospectId: string,
  templateKey: string,
  actor: Actor,
): Promise<SendOutcome> {
  const prospect = await loadProspect(prospectId)
  if (!prospect) return { ok: false, kind: 'failed', reason: 'prospect_not_found' }

  const tpl = await getTemplateByKey(templateKey || DEFAULT_TEMPLATE_KEY)
  if (!tpl) return { ok: false, kind: 'failed', reason: 'template_not_found' }

  const rendered = renderTemplate(tpl, prospect)
  const result = await sendOutreachEmail({
    to: BRIAN_EMAIL,
    subject: `[TEST] ${rendered.subject}`,
    text: rendered.text,
    html: rendered.html,
  })

  if (!result.sent) {
    await logSend({
      prospect, tpl, actor, toEmail: BRIAN_EMAIL, subject: rendered.subject,
      status: result.reason === 'no_config' ? 'skipped' : 'failed',
      isTest: true,
      failureReason: result.reason === 'send_failed' ? result.detail ?? 'send_failed' : null,
      skipReason: result.reason === 'no_config' ? 'email_not_configured' : null,
    })
    await trackEvent('outreach_test_email_sent', {
      actor: { id: actor.id, email: actor.email, role: 'admin' },
      metadata: { prospectId, templateKey: tpl.key, ok: false, reason: result.reason },
    })
    return { ok: false, kind: result.reason === 'no_config' ? 'skipped' : 'failed', reason: result.reason }
  }

  await logSend({
    prospect, tpl, actor, toEmail: BRIAN_EMAIL, subject: rendered.subject,
    status: 'test_sent', isTest: true,
    provider: 'resend', providerMessageId: result.providerMessageId,
  })
  await trackEvent('outreach_test_email_sent', {
    actor: { id: actor.id, email: actor.email, role: 'admin' },
    metadata: { prospectId, templateKey: tpl.key, ok: true },
  })
  return { ok: true, kind: 'test_sent', providerMessageId: result.providerMessageId }
}

// ── Real monthly invite ──────────────────────────────────────────────────────

export async function sendMonthlyInvite(
  prospectId: string,
  templateKey: string,
  actor: Actor,
  opts: { now?: Date } = {},
): Promise<SendOutcome> {
  const now = opts.now ?? new Date()
  const prospect = await loadProspect(prospectId)
  if (!prospect) return { ok: false, kind: 'failed', reason: 'prospect_not_found' }

  const tpl = await getTemplateByKey(templateKey || DEFAULT_TEMPLATE_KEY)
  if (!tpl) return { ok: false, kind: 'failed', reason: 'template_not_found' }

  // 1. Eligibility (prospect state + authoritative 30-day send-log check).
  const sent30 = await sentWithinCooldown(prospectId, now)
  const elig = evaluateEligibility(
    {
      id: prospect.id,
      dealershipName: prospect.dealershipName,
      publicEmail: prospect.publicEmail,
      sourceUrl: prospect.sourceUrl,
      status: prospect.status,
      archivedAt: prospect.archivedAt,
      doNotContactAt: prospect.doNotContactAt,
      nextEligibleAt: prospect.nextEligibleAt,
    },
    { now, sentWithinCooldown: sent30 },
  )
  if (!elig.eligible) {
    return skip(prospect, tpl, actor, elig.reason, elig.detail)
  }

  const to = normalizeEmail(prospect.publicEmail)

  // 2. Suppression list — hard stop.
  if (await isSuppressed(to)) {
    return skip(prospect, tpl, actor, 'suppressed', 'Email or domain is on the suppression list.')
  }

  // 3. Safety toggle — real sends require OUTREACH_SEND_ENABLED=true.
  if (!sendEnabled()) {
    const rendered = renderTemplate(tpl, prospect)
    await logSend({
      prospect, tpl, actor, toEmail: to, subject: rendered.subject,
      status: 'dry_run', skipReason: 'send_disabled',
      cooldownWindowStart: now, cooldownWindowEnd: nextEligibleFrom(now),
    })
    await trackEvent('outreach_monthly_invite_skipped', {
      actor: { id: actor.id, email: actor.email, role: 'admin' },
      metadata: { prospectId, templateKey: tpl.key, reason: 'send_disabled' },
    })
    return { ok: false, kind: 'dry_run', reason: 'send_disabled', detail: 'OUTREACH_SEND_ENABLED is not true — logged as dry_run.' }
  }

  // 4. Send for real.
  const rendered = renderTemplate(tpl, prospect)
  const result = await sendOutreachEmail({
    to, subject: rendered.subject, text: rendered.text, html: rendered.html,
  })

  if (!result.sent) {
    await logSend({
      prospect, tpl, actor, toEmail: to, subject: rendered.subject,
      status: result.reason === 'no_config' ? 'skipped' : 'failed',
      failureReason: result.reason === 'send_failed' ? result.detail ?? 'send_failed' : null,
      skipReason: result.reason === 'no_config' ? 'email_not_configured' : null,
    })
    await trackEvent('outreach_monthly_invite_skipped', {
      actor: { id: actor.id, email: actor.email, role: 'admin' },
      metadata: { prospectId, templateKey: tpl.key, reason: result.reason },
    })
    return { ok: false, kind: result.reason === 'no_config' ? 'skipped' : 'failed', reason: result.reason }
  }

  // 5. Success — log + advance the prospect's cooldown/status.
  const nextEligible = nextEligibleFrom(now)
  await logSend({
    prospect, tpl, actor, toEmail: to, subject: rendered.subject,
    status: 'sent', provider: 'resend', providerMessageId: result.providerMessageId,
    cooldownWindowStart: now, cooldownWindowEnd: nextEligible,
  })
  await db
    .update(dealerProspects)
    .set({
      status: 'sent_intro',
      lastContactedAt: now,
      nextEligibleAt: nextEligible,
      updatedAt: now,
    })
    .where(eq(dealerProspects.id, prospect.id))
  await trackEvent('outreach_monthly_invite_sent', {
    actor: { id: actor.id, email: actor.email, role: 'admin' },
    metadata: { prospectId, templateKey: tpl.key },
  })
  return { ok: true, kind: 'sent', providerMessageId: result.providerMessageId }
}

// ── Batch ────────────────────────────────────────────────────────────────────

export type BatchResult = {
  requested: number
  capped: boolean
  max: number
  sent: number
  skipped: number
  dryRun: number
  failed: number
  perProspect: Array<{ prospectId: string; dealershipName: string; outcome: SendOutcome }>
}

export async function sendBatch(
  prospectIds: string[],
  templateKey: string,
  actor: Actor,
): Promise<BatchResult> {
  const max = maxBatchSize()
  const unique = Array.from(new Set(prospectIds))
  const capped = unique.length > max
  // Hard cap — never send to more than the configured max.
  const ids = unique.slice(0, max)

  await trackEvent('outreach_batch_send_started', {
    actor: { id: actor.id, email: actor.email, role: 'admin' },
    metadata: { requested: unique.length, capped, max },
  })

  const names = await db
    .select({ id: dealerProspects.id, dealershipName: dealerProspects.dealershipName })
    .from(dealerProspects)
    .where(inArray(dealerProspects.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']))
  const nameById = new Map(names.map(r => [r.id, r.dealershipName]))

  const result: BatchResult = {
    requested: unique.length, capped, max, sent: 0, skipped: 0, dryRun: 0, failed: 0, perProspect: [],
  }

  // Sequential — small batches, and it keeps the Resend rate well within limits.
  for (const id of ids) {
    const outcome = await sendMonthlyInvite(id, templateKey, actor)
    if (outcome.ok && outcome.kind === 'sent') result.sent++
    else if (!outcome.ok && outcome.kind === 'dry_run') result.dryRun++
    else if (!outcome.ok && outcome.kind === 'failed') result.failed++
    else result.skipped++
    result.perProspect.push({ prospectId: id, dealershipName: nameById.get(id) ?? '(unknown)', outcome })
  }

  await trackEvent('outreach_batch_send_completed', {
    actor: { id: actor.id, email: actor.email, role: 'admin' },
    metadata: { sent: result.sent, skipped: result.skipped, dryRun: result.dryRun, failed: result.failed },
  })
  return result
}

// ── internals ────────────────────────────────────────────────────────────────

async function loadProspect(id: string): Promise<Prospect | null> {
  const rows = await db.select().from(dealerProspects).where(eq(dealerProspects.id, id)).limit(1)
  return rows[0] ?? null
}

async function skip(
  prospect: Prospect,
  tpl: typeof import('@/lib/db/schema').outreachTemplates.$inferSelect,
  actor: Actor,
  reason: string,
  detail: string,
): Promise<SendOutcome> {
  await logSend({
    prospect, tpl, actor,
    toEmail: normalizeEmail(prospect.publicEmail) || '(none)',
    subject: tpl.subject, status: 'skipped', skipReason: reason,
  })
  await trackEvent('outreach_monthly_invite_skipped', {
    actor: { id: actor.id, email: actor.email, role: 'admin' },
    metadata: { prospectId: prospect.id, templateKey: tpl.key, reason },
  })
  return { ok: false, kind: 'skipped', reason, detail }
}

async function logSend(args: {
  prospect: Prospect
  tpl: typeof import('@/lib/db/schema').outreachTemplates.$inferSelect
  actor: Actor
  toEmail: string
  subject: string
  status: string
  isTest?: boolean
  provider?: string
  providerMessageId?: string | null
  failureReason?: string | null
  skipReason?: string | null
  cooldownWindowStart?: Date | null
  cooldownWindowEnd?: Date | null
}): Promise<void> {
  try {
    await db.insert(outreachSends).values({
      prospectId: args.prospect.id,
      templateId: args.tpl.id,
      sentByUserId: /^[0-9a-f-]{36}$/i.test(args.actor.id) ? args.actor.id : null,
      sentByEmail: args.actor.email,
      toEmail: args.toEmail,
      fromEmail: outreachFromEmail(),
      subject: args.subject,
      status: args.status,
      provider: args.provider ?? null,
      providerMessageId: args.providerMessageId ?? null,
      failureReason: args.failureReason ?? null,
      skipReason: args.skipReason ?? null,
      isTest: args.isTest ?? false,
      cooldownWindowStart: args.cooldownWindowStart ?? null,
      cooldownWindowEnd: args.cooldownWindowEnd ?? null,
    })
  } catch (err) {
    console.error('[outreach-send] failed to write send log:', err instanceof Error ? err.message : String(err))
  }
}

// most recent sends for a prospect, newest first — used by the detail drawer
export async function recentSendsForProspect(prospectId: string, limit = 20) {
  return db
    .select()
    .from(outreachSends)
    .where(eq(outreachSends.prospectId, prospectId))
    .orderBy(desc(outreachSends.createdAt))
    .limit(limit)
}
