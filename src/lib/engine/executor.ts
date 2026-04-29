import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  leads, conversations, messages, phoneNumbers,
  workflowEnrollments, workflowStepExecutions, workflowSteps, tenants,
  type SendSmsConfig, type ConditionConfig, type AssignConfig,
} from '@/lib/db/schema'

// Drizzle relational query types need explicit assertion when accessed via with:{} relations
type LeadRow = typeof leads.$inferSelect
type StepRow = typeof workflowSteps.$inferSelect
import { shouldStop } from './stop-conditions'
import { evaluateCondition } from './conditions'
import { scheduleStep } from './scheduler'
import { escalateToHuman } from './escalate'
import { getRetryDelay, hasRetriesRemaining } from './retry'
import { runSendGuard, GUARD_CANCEL_REASONS, type SendGuardReason } from './send-guard'
import { sendMessage } from '@/lib/messaging/send'
import { workflowStepQueue } from '@/lib/queue/queues'
import { transition } from '@/lib/lead/state-machine'

export async function executeStep(stepExecutionId: string): Promise<void> {
  // ── Load execution with full context ──────────────────────────────────────
  // Flatten the nested load to avoid silent undefined crashes if relations
  // aren't wired correctly at the DB level.
  const execution = await db.query.workflowStepExecutions.findFirst({
    where: eq(workflowStepExecutions.id, stepExecutionId),
    with: { step: true, enrollment: true },
  })

  if (!execution) {
    console.error(`[executor] Step execution ${stepExecutionId} not found`)
    return
  }
  if (execution.status !== 'pending') {
    console.warn(`[executor] Step ${stepExecutionId} already ${execution.status} — skipping (idempotent)`)
    return
  }

  // Load lead and workflow steps separately — avoids deep nested with failures
  const enrollment = await db.query.workflowEnrollments.findFirst({
    where: eq(workflowEnrollments.id, execution.enrollmentId),
    with: { lead: true },
  })
  if (!enrollment?.lead) {
    console.error(`[executor] Enrollment or lead missing for execution ${stepExecutionId}`)
    await db
      .update(workflowStepExecutions)
      .set({ status: 'failed', executedAt: new Date(), error: 'Enrollment or lead not found' })
      .where(eq(workflowStepExecutions.id, stepExecutionId))
    return
  }

  const allSteps = await db.query.workflowSteps.findMany({
    where: eq(workflowSteps.workflowId, enrollment.workflowId),
    orderBy: (s, { asc }) => [asc(s.position)],
  })
  if (allSteps.length === 0) {
    console.error(`[executor] No steps found for workflow ${enrollment.workflowId}`)
    return
  }

  const lead = enrollment.lead as LeadRow
  const step = execution.step as StepRow

  // ── Stop condition check ──────────────────────────────────────────────────
  const stopReason = shouldStop({
    leadState: lead.state as Parameters<typeof shouldStop>[0]['leadState'],
    enrollmentStatus: enrollment.status,
  })

  if (stopReason) {
    console.log(`[executor] Stop condition '${stopReason}' for execution ${stepExecutionId} — cancelling enrollment`)
    await db
      .update(workflowStepExecutions)
      .set({ status: 'skipped', executedAt: new Date(), error: `Stopped: ${stopReason}` })
      .where(eq(workflowStepExecutions.id, stepExecutionId))
    if (enrollment.status === 'active') {
      await db
        .update(workflowEnrollments)
        .set({ status: 'cancelled', completedAt: new Date(), stopReason, stoppedAt: new Date() })
        .where(eq(workflowEnrollments.id, enrollment.id))
    }
    return
  }

  // ── Execute ───────────────────────────────────────────────────────────────
  try {
    const config = step.config
    let shouldAdvance = true

    if (config.type === 'send_sms') {
      const result = await executeSendSms(config, lead, enrollment, step.id, execution)
      // guard cancelled path — do not advance
      if (result === 'cancelled') return

    } else if (config.type === 'condition') {
      const outcome = evaluateCondition(config as ConditionConfig, {
        leadState: lead.state as Parameters<typeof evaluateCondition>[1]['leadState'],
      })

      if (outcome === 'stop') {
        await markEnrollmentDone(stepExecutionId, enrollment.id, 'completed', 'condition_stop')
        await maybeMarkExhausted(enrollment.id, lead.id, lead.state)
        return
      }

      await db
        .update(workflowStepExecutions)
        .set({
          status: outcome === 'skip' ? 'skipped' : 'executed',
          executedAt: new Date(),
          ...(outcome === 'skip' ? { skipReason: 'condition_skip', skippedAt: new Date() } : {}),
        })
        .where(eq(workflowStepExecutions.id, stepExecutionId))

    } else if (config.type === 'assign') {
      await executeAssign(config as AssignConfig, lead.id)
      await db
        .update(workflowStepExecutions)
        .set({ status: 'executed', executedAt: new Date() })
        .where(eq(workflowStepExecutions.id, stepExecutionId))
    }

    if (shouldAdvance) {
      await advanceEnrollment(enrollment.id, step.position, allSteps)
    }
  } catch (err) {
    await handleStepError(stepExecutionId, enrollment.id, execution.retryCount, err)
  }
}

// ── Step handlers ─────────────────────────────────────────────────────────

// Returns 'ok' to continue advancing, 'cancelled' to halt.
async function executeSendSms(
  config: SendSmsConfig,
  lead: typeof leads.$inferSelect,
  enrollment: typeof workflowEnrollments.$inferSelect,
  stepId: string,
  stepExecution: typeof workflowStepExecutions.$inferSelect,
): Promise<'ok' | 'cancelled'> {
  const enrollmentId   = enrollment.id
  const stepExecutionId = stepExecution.id

  // ── Load tenant for template rendering and guard ──────────────────────────
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, lead.tenantId) })

  // ── Send-time guard — canonical pre-send decision point ───────────────────
  //
  // Runs before template rendering and before calling the SMS provider.
  // Any block here results in a skipped/cancelled step with a full audit row.
  const guard = await runSendGuard({
    lead,
    enrollment,
    stepExecutionId,
    scheduledAt: stepExecution.scheduledAt,
    tenant,
    workflowId: enrollment.workflowId,
  })

  if (!guard.allowed) {
    const shouldCancel = GUARD_CANCEL_REASONS.has(guard.reason)
    console.log(
      `[send-guard] BLOCKED — step ${stepExecutionId} | reason: ${guard.reason}` +
      (guard.detail ? ` | ${guard.detail}` : '') +
      ` | enrollment: ${shouldCancel ? 'cancel' : 'skip'}`
    )

    // Render template now so the audit row shows the intended message body
    const rawAuditBody = renderTemplate(config.template, buildTemplateVars(lead, tenant))
    const body = config.optOutFooter ? `${rawAuditBody}\n\n${config.optOutFooter}` : rawAuditBody

    // Write audit row with skip_reason stamped
    await writeGuardAuditRow({
      tenantId: lead.tenantId,
      leadId: lead.id,
      to: lead.phone,
      body,
      workflowStepId: stepId,
      stepExecutionId,
      skipReason: guard.reason,
    })

    // Mark step execution as skipped
    await db
      .update(workflowStepExecutions)
      .set({ status: 'skipped', executedAt: new Date(), error: `guard:${guard.reason}` })
      .where(eq(workflowStepExecutions.id, stepExecutionId))

    // Cancel or leave enrollment based on reason category
    if (shouldCancel && enrollment.status === 'active') {
      await db
        .update(workflowEnrollments)
        .set({
          status: 'cancelled',
          completedAt: new Date(),
          stopReason: guard.reason,
          stoppedAt: new Date(),
        })
        .where(eq(workflowEnrollments.id, enrollmentId))
    }

    return 'cancelled'
  }

  // ── Guard passed — render and send ───────────────────────────────────────
  // Build the same body that preview.ts produces: template + opt-out footer.
  // The footer (if set) is appended here so the sent body exactly matches the
  // dry-run preview that was reviewed and approved.
  const rawBody = renderTemplate(config.template, buildTemplateVars(lead, tenant))
  const body = config.optOutFooter ? `${rawBody}\n\n${config.optOutFooter}` : rawBody

  const outcome = await sendMessage({
    tenantId: lead.tenantId,
    leadId: lead.id,
    to: lead.phone,
    body,
    workflowStepId: stepId,
    stepExecutionId,  // idempotency: one message per step execution
  })

  // Belt-and-suspenders: sendMessage can still return skipped if SMS_LIVE_MODE
  // was toggled off between the guard check and the provider call.
  if (outcome.skipped) {
    console.warn(`[executor] sendMessage skipped after guard passed — reason: ${outcome.skipped}`)
    await db
      .update(workflowStepExecutions)
      .set({ status: 'skipped', executedAt: new Date(), error: `post-guard:${outcome.skipped}` })
      .where(eq(workflowStepExecutions.id, stepExecutionId))
    return 'cancelled'
  }

  // Stamp lastAutomatedAt so cooldown and eligibility checks stay accurate
  if (!outcome.dryRun) {
    await db
      .update(leads)
      .set({ lastAutomatedAt: new Date(), updatedAt: new Date() })
      .where(eq(leads.id, lead.id))
  }

  await db
    .update(workflowStepExecutions)
    .set({ status: 'executed', executedAt: new Date() })
    .where(eq(workflowStepExecutions.id, stepExecutionId))

  return 'ok'
}

// ── Template helpers ──────────────────────────────────────────────────────────

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')
}


function buildTemplateVars(
  lead: typeof leads.$inferSelect,
  tenant: typeof tenants.$inferSelect | null | undefined,
): Record<string, string> {
  return {
    firstName: lead.firstName,
    lastName: lead.lastName,
    fullName: `${lead.firstName} ${lead.lastName}`,
    vehicleOfInterest: lead.vehicleOfInterest ?? '',
    dealershipName: tenant?.name ?? '',
    dealerPhone: ((tenant?.settings ?? {}) as Record<string, string>).dealerPhone ?? '',
  }
}

// ── Guard audit row writer ────────────────────────────────────────────────────
//
// Creates a message row (status=queued, skip_reason set) so the audit trail
// shows exactly what would have been sent and why it was blocked.
// Non-fatal — a failure here should not prevent the step from being marked skipped.

async function writeGuardAuditRow(p: {
  tenantId: string
  leadId: string
  to: string
  body: string
  workflowStepId?: string
  stepExecutionId: string
  skipReason: SendGuardReason
}): Promise<void> {
  try {
    const phoneNumber = await db.query.phoneNumbers.findFirst({
      where: eq(phoneNumbers.tenantId, p.tenantId),
    })
    if (!phoneNumber) return // no phone configured — skip audit row silently

    const [conversation] = await db
      .insert(conversations)
      .values({
        tenantId: p.tenantId,
        leadId: p.leadId,
        tenantPhone: phoneNumber.number,
        leadPhone: p.to,
      })
      .onConflictDoUpdate({ target: conversations.leadId, set: { updatedAt: new Date() } })
      .returning()

    await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        direction: 'outbound',
        body: p.body,
        status: 'queued',
        workflowStepId: p.workflowStepId ?? null,
        stepExecutionId: p.stepExecutionId,
        skipReason: p.skipReason,
        skippedAt: new Date(),
      })
      .onConflictDoNothing() // stepExecutionId unique index — safe to retry
  } catch (err) {
    console.error('[executor] Failed to write guard audit row:', err instanceof Error ? err.message : err)
  }
}

async function executeAssign(config: AssignConfig, leadId: string): Promise<void> {
  if (config.to === 'original_salesperson') return
  await db
    .update(leads)
    .set({ salespersonId: config.to, updatedAt: new Date() })
    .where(eq(leads.id, leadId))
}

// ── Advance enrollment to next step ──────────────────────────────────────

async function advanceEnrollment(
  enrollmentId: string,
  currentPosition: number,
  allSteps: typeof workflowSteps.$inferSelect[]
): Promise<void> {
  const nextStep = allSteps.find((s) => s.position > currentPosition)

  if (!nextStep) {
    // No more steps — enrollment complete
    await markEnrollmentDone(null, enrollmentId, 'completed', 'all_steps_executed')
    const enrollment = await db.query.workflowEnrollments.findFirst({
      where: eq(workflowEnrollments.id, enrollmentId),
      with: { lead: true },
    })
    if (enrollment) {
      const lead2 = enrollment.lead as LeadRow
      await maybeMarkExhausted(enrollmentId, lead2.id, lead2.state)
    }
    return
  }

  const cfg = nextStep.config as SendSmsConfig | ConditionConfig | AssignConfig
  const delayMs = ('delayHours' in cfg && cfg.delayHours ? cfg.delayHours : 0) * 60 * 60 * 1000

  await db
    .update(workflowEnrollments)
    .set({ currentStepPosition: nextStep.position })
    .where(eq(workflowEnrollments.id, enrollmentId))

  await scheduleStep(enrollmentId, nextStep.id, delayMs)
}

async function markEnrollmentDone(
  stepExecutionId: string | null,
  enrollmentId: string,
  finalStatus: 'completed' | 'cancelled',
  stopReason?: string,
): Promise<void> {
  if (stepExecutionId) {
    await db
      .update(workflowStepExecutions)
      .set({ status: 'executed', executedAt: new Date() })
      .where(eq(workflowStepExecutions.id, stepExecutionId))
  }
  await db
    .update(workflowEnrollments)
    .set({
      status: finalStatus,
      completedAt: new Date(),
      stopReason: stopReason ?? finalStatus,
      stoppedAt: new Date(),
    })
    .where(eq(workflowEnrollments.id, enrollmentId))
}

async function maybeMarkExhausted(
  enrollmentId: string,
  leadId: string,
  leadState: string
): Promise<void> {
  // Only mark exhausted if the lead is still in 'enrolled' — if they've already
  // responded or been manually updated, leave the state alone.
  if (leadState === 'enrolled') {
    await transition(leadId, 'exhausted', { reason: 'Workflow completed — no response' })
  }
}

// ── Error + retry ─────────────────────────────────────────────────────────

async function handleStepError(
  stepExecutionId: string,
  enrollmentId: string,
  retryCount: number,
  err: unknown
): Promise<void> {
  const errorMsg = err instanceof Error ? err.message : String(err)
  console.error(`[executor] Step ${stepExecutionId} attempt ${retryCount + 1} failed: ${errorMsg}`)

  if (hasRetriesRemaining(retryCount)) {
    const delayMs = getRetryDelay(retryCount)!
    console.log(`[executor] Scheduling retry ${retryCount + 1} in ${delayMs / 1000}s for ${stepExecutionId}`)

    // Log the failed attempt before resetting to pending for the retry
    await db
      .update(workflowStepExecutions)
      .set({
        retryCount: retryCount + 1,
        error: `Attempt ${retryCount + 1}: ${errorMsg}`,
        // Keep status 'pending' so the retry job passes the status guard
      })
      .where(eq(workflowStepExecutions.id, stepExecutionId))

    await workflowStepQueue.add(
      'execute-step',
      { stepExecutionId, isRetry: true },
      { delay: delayMs, jobId: `retry-${stepExecutionId}-${retryCount + 1}` }
    )
  } else {
    console.error(`[executor] Step ${stepExecutionId} exhausted retries — escalating`)
    await db
      .update(workflowStepExecutions)
      .set({ status: 'failed', executedAt: new Date(), error: `Final failure after ${retryCount + 1} attempts: ${errorMsg}` })
      .where(eq(workflowStepExecutions.id, stepExecutionId))

    await escalateToHuman(enrollmentId, `Step failed after ${retryCount + 1} attempts: ${errorMsg}`)
  }
}

