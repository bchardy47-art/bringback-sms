/**
 * Phase 11 — First Live Pilot State Machine
 *
 * Manages the controlled smoke-test → remaining-sends lifecycle for a batch
 * that is marked isFirstPilot = true.
 *
 * State machine:
 *   not_started
 *     → (validateReadiness + startSmokeTest) → smoke_test_sending
 *         → (verifySmokeTest OK)  → smoke_test_passed → ready_for_remaining
 *         → (verifySmokeTest fail) → smoke_test_failed   [batch paused]
 *   ready_for_remaining
 *     → (startRemaining) → remaining_sending → completed
 *
 * Any STOP or complaint during the pilot sets continuationRequired = true,
 * which blocks startRemaining until an admin calls confirmContinuation().
 *
 * Safety invariants enforced here:
 *   - FIRST_PILOT_CAP (5) hard cap on lead count
 *   - smoke test sends exactly one lead
 *   - remaining sends blocked until smoke test passed
 *   - remaining sends blocked if continuationRequired
 *   - remaining sends blocked if batch is paused/cancelled
 *   - webhook config verified before any live send
 */

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  pilotBatches, pilotBatchLeads, workflowEnrollments, workflowSteps,
  workflowStepExecutions, messages, optOuts, handoffTasks, leads,
  FIRST_PILOT_CAP,
  type FirstPilotState,
  type SendSmsConfig,
} from '@/lib/db/schema'
import { scheduleStep, cancelPendingExecutions } from '@/lib/engine/scheduler'
import { runPreflight } from '@/lib/engine/preflight'

// Type alias so Drizzle's relational query result is explicit in callbacks
type PilotBatchLeadRow = typeof pilotBatchLeads.$inferSelect

// ── Types ─────────────────────────────────────────────────────────────────────

export type FirstPilotReadinessCheck = {
  id: string
  label: string
  passed: boolean
  detail: string
}

export type FirstPilotStatus = {
  batchId: string
  tenantId: string
  workflowId: string
  firstPilotState: FirstPilotState
  isFirstPilot: boolean
  leadCount: number
  approvedLeadCount: number
  sentCount: number
  skippedCount: number
  replyCount: number
  handoffCount: number
  optOutCount: number
  continuationRequired: boolean
  continuationReason: string | null
  blockers: string[]
  warnings: string[]
  nextAction: string
  readinessChecks: FirstPilotReadinessCheck[]
  smokeTestLeadId: string | null
  smokeTestSentAt: Date | null
  smokeTestPassedAt: Date | null
  smokeTestFailedAt: Date | null
  smokeTestFailReason: string | null
  auditRowVerified: boolean
  providerIdVerified: boolean
}

// ── Readiness checks ──────────────────────────────────────────────────────────

export async function validateFirstPilotReadiness(
  batchId: string
): Promise<{ ready: boolean; checks: FirstPilotReadinessCheck[]; blockers: string[] }> {
  const batch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, batchId),
    with: { leads: true },
  })
  if (!batch) throw new Error(`Batch ${batchId} not found`)

  const checks: FirstPilotReadinessCheck[] = []
  const blockers: string[] = []

  const fail = (id: string, label: string, detail: string) => {
    checks.push({ id, label, passed: false, detail })
    blockers.push(detail)
  }
  const pass = (id: string, label: string, detail: string) => {
    checks.push({ id, label, passed: true, detail })
  }

  // 1. Must be a first-pilot batch
  if (!batch.isFirstPilot) {
    fail('is_first_pilot', 'Marked as first pilot', 'Batch is not marked as a first pilot batch')
  } else {
    pass('is_first_pilot', 'Marked as first pilot', 'isFirstPilot = true')
  }

  // 2. Lead count must not exceed FIRST_PILOT_CAP
  if (batch.leads.length > FIRST_PILOT_CAP) {
    fail('lead_cap', 'Lead count ≤ 5', `Batch has ${batch.leads.length} leads — first pilot cap is ${FIRST_PILOT_CAP}`)
  } else if (batch.leads.length === 0) {
    fail('lead_cap', 'At least one lead', 'Batch has no leads')
  } else {
    pass('lead_cap', 'Lead count ≤ 5', `${batch.leads.length} lead(s) — within cap`)
  }

  // 3. Batch must be approved
  if (batch.status !== 'approved') {
    fail('batch_approved', 'Batch approved', `Batch status is '${batch.status}' — must be 'approved'`)
  } else {
    pass('batch_approved', 'Batch approved', 'Batch is in approved status')
  }

  // 4. Phase 8 preflight
  const preflight = await runPreflight(batch.tenantId, batch.workflowId)
  if (!preflight.allowed) {
    const blockerLabels = preflight.failedBlockers.map(c => c.label).join(', ')
    fail('preflight', 'Phase 8 readiness passes', `Preflight blockers: ${blockerLabels}`)
  } else {
    pass('preflight', 'Phase 8 readiness passes', 'All Phase 8 readiness checks passed')
  }

  // 5. At least one approved eligible lead
  const pendingLeads = batch.leads.filter((l: PilotBatchLeadRow) => l.approvedForSend && l.sendStatus === 'pending')
  if (pendingLeads.length === 0) {
    fail('pending_leads', 'Approved leads available', 'No leads are approved and pending send')
  } else {
    pass('pending_leads', 'Approved leads available', `${pendingLeads.length} lead(s) approved and pending`)
  }

  // 6. Dry-run preview reviewed
  if (!batch.dryRunSummary) {
    fail('dry_run', 'Dry-run preview reviewed', 'No dry-run preview has been generated for this batch')
  } else {
    pass('dry_run', 'Dry-run preview reviewed', `Preview generated at ${batch.dryRunSummary.generatedAt}`)
  }

  // 7. Webhook configured (TELNYX_PUBLIC_KEY in production, or webhook in any env)
  const webhookConfigured =
    process.env.NODE_ENV !== 'production' || !!process.env.TELNYX_PUBLIC_KEY
  if (!webhookConfigured) {
    fail('webhook', 'Webhook signature configured', 'TELNYX_PUBLIC_KEY must be set in production for webhook signature verification')
  } else {
    pass('webhook', 'Webhook signature configured', process.env.TELNYX_PUBLIC_KEY ? 'TELNYX_PUBLIC_KEY is set' : 'Dev mode — signature check skipped')
  }

  // 8. No active continuation requirement
  if (batch.continuationRequired) {
    fail('continuation', 'No pending continuation required', `Manual confirmation required: ${batch.continuationReason ?? 'STOP or complaint received'}`)
  } else {
    pass('continuation', 'No pending continuation required', 'No unconfirmed STOP or complaints')
  }

  const ready = blockers.length === 0
  return { ready, checks, blockers }
}

// ── Start smoke test ──────────────────────────────────────────────────────────

/**
 * Enroll exactly one lead as the smoke test.
 * The lead to use is the first approved, pending lead in the batch.
 */
export async function startSmokeTest(
  batchId: string
): Promise<{ success: boolean; error?: string; smokeTestLeadId?: string }> {
  const batch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, batchId),
    with: { leads: true },
  })
  if (!batch) return { success: false, error: 'Batch not found' }

  // State gate
  if (!['approved'].includes(batch.status)) {
    return { success: false, error: `Batch must be in 'approved' status (is '${batch.status}')` }
  }
  if (!['not_started', 'ready_for_smoke_test'].includes(batch.firstPilotState)) {
    return { success: false, error: `Cannot start smoke test from state '${batch.firstPilotState}'` }
  }

  // Safety cap
  if (batch.leads.length > FIRST_PILOT_CAP) {
    return {
      success: false,
      error: `First pilot cap exceeded: ${batch.leads.length} leads (max ${FIRST_PILOT_CAP})`,
    }
  }

  // Pick the first pending approved lead
  const smokeLeadRow = batch.leads.find((l: PilotBatchLeadRow) => l.approvedForSend && l.sendStatus === 'pending' && !l.enrollmentId)
  if (!smokeLeadRow) {
    return { success: false, error: 'No approved pending lead available for smoke test' }
  }

  // Load the full lead record for enrollment
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, smokeLeadRow.leadId) })
  if (!lead) return { success: false, error: 'Lead record not found' }

  // Load workflow steps (first step)
  const wfSteps = await db.query.workflowSteps.findMany({
    where: eq(workflowSteps.workflowId, batch.workflowId),
    orderBy: (s, { asc }) => [asc(s.position)],
  })
  if (wfSteps.length === 0) return { success: false, error: 'Workflow has no steps' }

  const firstStep = wfSteps[0]
  const cfg = firstStep.config as SendSmsConfig
  const delayMs = (cfg.delayHours ?? 0) * 60 * 60 * 1000

  // Create enrollment
  const [enrollment] = await db.insert(workflowEnrollments).values({
    workflowId: batch.workflowId,
    leadId: lead.id,
    status: 'active',
    currentStepPosition: firstStep.position,
    enrolledAt: new Date(),
  }).returning()

  // Schedule first step
  await scheduleStep(enrollment.id, firstStep.id, delayMs)

  const now = new Date()

  // Update pilot_batch_lead with enrollment
  await db.update(pilotBatchLeads)
    .set({ enrollmentId: enrollment.id, sendStatus: 'sent', updatedAt: now })
    .where(eq(pilotBatchLeads.id, smokeLeadRow.id))

  // Update batch state
  await db.update(pilotBatches)
    .set({
      status: 'sending',
      firstPilotState: 'smoke_test_sending',
      smokeTestLeadId: smokeLeadRow.id,
      smokeTestSentAt: now,
      startedAt: batch.startedAt ?? now,
      updatedAt: now,
    })
    .where(eq(pilotBatches.id, batchId))

  return { success: true, smokeTestLeadId: smokeLeadRow.id }
}

// ── Verify smoke test ─────────────────────────────────────────────────────────

/**
 * Check that the smoke test enrollment produced a valid audit/message row.
 * - Looks for a messages row for the smoke test enrollment
 * - Checks if providerMessageId is present
 * - Updates batch state accordingly
 */
export async function verifySmokeTest(
  batchId: string
): Promise<{
  passed: boolean
  auditRowFound: boolean
  providerIdFound: boolean
  error?: string
  state: FirstPilotState
}> {
  const batch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, batchId),
    with: { leads: true },
  })
  if (!batch) return { passed: false, auditRowFound: false, providerIdFound: false, error: 'Batch not found', state: 'smoke_test_failed' }

  if (batch.firstPilotState !== 'smoke_test_sending') {
    return {
      passed: false,
      auditRowFound: false,
      providerIdFound: false,
      error: `Cannot verify smoke test from state '${batch.firstPilotState}'`,
      state: batch.firstPilotState as FirstPilotState,
    }
  }

  // Find the smoke test lead's enrollment
  const smokeLeadRow = batch.leads.find((l: PilotBatchLeadRow) => l.id === batch.smokeTestLeadId)
  if (!smokeLeadRow?.enrollmentId) {
    await db.update(pilotBatches).set({
      firstPilotState: 'smoke_test_failed',
      smokeTestFailedAt: new Date(),
      smokeTestFailReason: 'Smoke test enrollment not found',
      status: 'paused',
      updatedAt: new Date(),
    }).where(eq(pilotBatches.id, batchId))
    return { passed: false, auditRowFound: false, providerIdFound: false, state: 'smoke_test_failed' }
  }

  // Find the executions for the enrollment
  const executions = await db.query.workflowStepExecutions.findMany({
    where: eq(workflowStepExecutions.enrollmentId, smokeLeadRow.enrollmentId),
  })

  if (executions.length === 0) {
    // Not yet run — still sending
    return { passed: false, auditRowFound: false, providerIdFound: false, state: 'smoke_test_sending' }
  }

  // Find the message row for any execution
  const execIds = executions.map(e => e.id)
  const messageRow = execIds.length > 0
    ? await db.query.messages.findFirst({
        where: inArray(messages.stepExecutionId, execIds),
      })
    : null

  const auditRowFound  = !!messageRow
  const providerIdFound = !!(messageRow?.providerMessageId)

  const now = new Date()

  if (!auditRowFound) {
    // Message row missing — fail
    await db.update(pilotBatches).set({
      firstPilotState: 'smoke_test_failed',
      smokeTestFailedAt: now,
      smokeTestFailReason: 'No message audit row found after smoke test send',
      auditRowVerified: false,
      providerIdVerified: false,
      status: 'paused',
      updatedAt: now,
    }).where(eq(pilotBatches.id, batchId))
    return { passed: false, auditRowFound, providerIdFound, state: 'smoke_test_failed' }
  }

  // Audit row exists — pass regardless of providerMessageId (provider ID may be
  // absent in dev/dry-run mode; live mode should always have it).
  await db.update(pilotBatches).set({
    firstPilotState: 'smoke_test_passed',
    smokeTestPassedAt: now,
    auditRowVerified: true,
    providerIdVerified: providerIdFound,
    updatedAt: now,
  }).where(eq(pilotBatches.id, batchId))

  return { passed: true, auditRowFound, providerIdFound, state: 'smoke_test_passed' }
}

// ── Start remaining leads ─────────────────────────────────────────────────────

/**
 * Enroll all remaining approved, pending leads after the smoke test passes.
 * Blocked if:
 *   - smoke test has not passed
 *   - continuationRequired is set
 *   - batch is paused/cancelled
 */
export async function startRemainingLeads(
  batchId: string
): Promise<{ success: boolean; enrolledCount: number; error?: string }> {
  const batch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, batchId),
    with: { leads: true },
  })
  if (!batch) return { success: false, enrolledCount: 0, error: 'Batch not found' }

  // State gates
  if (!['smoke_test_passed', 'ready_for_remaining'].includes(batch.firstPilotState)) {
    return {
      success: false,
      enrolledCount: 0,
      error: `Cannot start remaining leads from state '${batch.firstPilotState}' — smoke test must pass first`,
    }
  }
  if (batch.continuationRequired) {
    return {
      success: false,
      enrolledCount: 0,
      error: `Manual confirmation required before continuing: ${batch.continuationReason ?? 'STOP or complaint received'}`,
    }
  }
  if (['paused', 'cancelled'].includes(batch.status)) {
    return { success: false, enrolledCount: 0, error: `Batch is ${batch.status}` }
  }

  // Load workflow steps
  const wfSteps = await db.query.workflowSteps.findMany({
    where: eq(workflowSteps.workflowId, batch.workflowId),
    orderBy: (s, { asc }) => [asc(s.position)],
  })
  if (wfSteps.length === 0) return { success: false, enrolledCount: 0, error: 'Workflow has no steps' }
  const firstStep = wfSteps[0]
  const cfg = firstStep.config as SendSmsConfig
  const delayMs = (cfg.delayHours ?? 0) * 60 * 60 * 1000

  // Remaining leads = approved, pending, not already enrolled, not the smoke test lead
  const remaining = batch.leads.filter(
    (l: PilotBatchLeadRow) => l.approvedForSend && l.sendStatus === 'pending' && !l.enrollmentId && l.id !== batch.smokeTestLeadId
  )

  if (remaining.length === 0) {
    await db.update(pilotBatches).set({
      firstPilotState: 'completed',
      status: 'completed',
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(pilotBatches.id, batchId))
    return { success: true, enrolledCount: 0 }
  }

  const now = new Date()
  let enrolledCount = 0

  for (const batchLead of remaining) {
    const lead = await db.query.leads.findFirst({ where: eq(leads.id, batchLead.leadId) })
    if (!lead) continue

    const [enrollment] = await db.insert(workflowEnrollments).values({
      workflowId: batch.workflowId,
      leadId: lead.id,
      status: 'active',
      currentStepPosition: firstStep.position,
      enrolledAt: now,
    }).returning()

    await scheduleStep(enrollment.id, firstStep.id, delayMs)

    await db.update(pilotBatchLeads)
      .set({ enrollmentId: enrollment.id, sendStatus: 'sent', updatedAt: now })
      .where(eq(pilotBatchLeads.id, batchLead.id))

    enrolledCount++
  }

  await db.update(pilotBatches).set({
    firstPilotState: 'remaining_sending',
    remainingStartedAt: now,
    updatedAt: now,
  }).where(eq(pilotBatches.id, batchId))

  return { success: true, enrolledCount }
}

// ── Confirm continuation ──────────────────────────────────────────────────────

/**
 * Admin confirms that a STOP or complaint occurred and they want to continue
 * sending to remaining leads. Clears the continuationRequired flag.
 */
export async function confirmContinuation(
  batchId: string,
  confirmedBy: string
): Promise<{ success: boolean; error?: string }> {
  const batch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, batchId),
  })
  if (!batch) return { success: false, error: 'Batch not found' }
  if (!batch.continuationRequired) return { success: true } // already clear

  await db.update(pilotBatches).set({
    continuationRequired: false,
    continuationConfirmedBy: confirmedBy,
    continuationConfirmedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(pilotBatches.id, batchId))

  return { success: true }
}

// ── Get first pilot status ────────────────────────────────────────────────────

/**
 * Return a rich snapshot of the first pilot's current state,
 * including live counts from the DB.
 */
export async function getFirstPilotStatus(batchId: string): Promise<FirstPilotStatus | null> {
  const batch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, batchId),
    with: { leads: true },
  })
  if (!batch) return null

  const leadIds = batch.leads.map((l: PilotBatchLeadRow) => l.leadId)

  // Opt-out count for batch leads
  let optOutCount = 0
  if (leadIds.length > 0) {
    const leadRecords = await db.query.leads.findMany({
      where: inArray(leads.id, leadIds),
    })
    const phones = leadRecords.map(l => l.phone)
    const optOutRows = phones.length > 0
      ? await db.query.optOuts.findMany({
          where: and(
            eq(optOuts.tenantId, batch.tenantId),
            inArray(optOuts.phone, phones),
          ),
        })
      : []
    optOutCount = optOutRows.length
  }

  // Handoff/escalation count for batch leads
  let handoffCountLive = 0
  let hasPendingComplaint = false
  if (leadIds.length > 0) {
    const tasks = await db.query.handoffTasks.findMany({
      where: and(
        eq(handoffTasks.tenantId, batch.tenantId),
        inArray(handoffTasks.leadId, leadIds),
      ),
    })
    handoffCountLive = tasks.length
    hasPendingComplaint = tasks.some(
      t => t.taskType === 'escalation' && ['open', 'in_progress'].includes(t.status)
    )
  }

  // If a complaint appeared and we haven't flagged it yet, do so
  if (hasPendingComplaint && !batch.continuationRequired && batch.firstPilotState === 'remaining_sending') {
    await db.update(pilotBatches).set({
      continuationRequired: true,
      continuationReason: 'Escalation complaint received during pilot — manual confirmation required',
      updatedAt: new Date(),
    }).where(eq(pilotBatches.id, batchId))
  }

  const approvedLeadCount = batch.leads.filter((l: PilotBatchLeadRow) => l.approvedForSend).length
  const sentCount         = batch.leads.filter((l: PilotBatchLeadRow) => l.sendStatus === 'sent').length
  const skippedCount      = batch.leads.filter((l: PilotBatchLeadRow) => l.sendStatus === 'skipped').length

  // Determine next action and blockers
  const blockers: string[] = []
  const warnings: string[] = []
  let nextAction: string

  const state = batch.firstPilotState as FirstPilotState

  if (batch.continuationRequired) {
    blockers.push(`Manual confirmation required: ${batch.continuationReason ?? 'STOP or complaint received'}`)
  }
  if (!batch.providerIdVerified && state === 'smoke_test_passed') {
    warnings.push('Provider message ID was not confirmed — verify Telnyx received the message')
  }

  switch (state) {
    case 'not_started':
      nextAction = 'Validate readiness, then click "Start Smoke Test"'
      break
    case 'ready_for_smoke_test':
      nextAction = 'Click "Start Smoke Test" to send the first lead'
      break
    case 'smoke_test_sending':
      nextAction = 'Wait for message to send, then click "Verify Smoke Test"'
      break
    case 'smoke_test_passed':
      nextAction = blockers.length > 0
        ? 'Resolve blockers, then send remaining leads'
        : 'Review smoke test results, then click "Send Remaining Leads"'
      break
    case 'smoke_test_failed':
      nextAction = 'Investigate why the smoke test failed, then restart the batch'
      blockers.push(`Smoke test failed: ${batch.smokeTestFailReason ?? 'see details'}`)
      break
    case 'ready_for_remaining':
      nextAction = blockers.length > 0
        ? 'Resolve blockers before sending remaining leads'
        : 'Click "Send Remaining Leads"'
      break
    case 'remaining_sending':
      nextAction = 'Monitor sends in progress — check Message Audit and Handoff Queue'
      break
    case 'completed':
      nextAction = 'Pilot complete — review results before expanding to broader automation'
      break
    case 'paused':
      nextAction = 'Batch is paused — resume or cancel from the Pilot panel'
      break
    case 'cancelled':
      nextAction = 'Batch cancelled — create a new batch to try again'
      break
    default:
      nextAction = 'Unknown state'
  }

  return {
    batchId,
    tenantId: batch.tenantId,
    workflowId: batch.workflowId,
    firstPilotState: state,
    isFirstPilot: batch.isFirstPilot,
    leadCount: batch.leads.length,
    approvedLeadCount,
    sentCount,
    skippedCount,
    replyCount: batch.replyCount,
    handoffCount: handoffCountLive,
    optOutCount,
    continuationRequired: batch.continuationRequired,
    continuationReason: batch.continuationReason,
    blockers,
    warnings,
    nextAction,
    readinessChecks: [],
    smokeTestLeadId: batch.smokeTestLeadId,
    smokeTestSentAt: batch.smokeTestSentAt,
    smokeTestPassedAt: batch.smokeTestPassedAt,
    smokeTestFailedAt: batch.smokeTestFailedAt,
    smokeTestFailReason: batch.smokeTestFailReason,
    auditRowVerified: batch.auditRowVerified,
    providerIdVerified: batch.providerIdVerified,
  }
}
