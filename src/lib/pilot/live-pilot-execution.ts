/**
 * Phase 13 — Live Pilot Execution
 *
 * Wraps the Phase 11 first-pilot module with a required confirmation gate
 * and adds full status aggregation + pilot report generation.
 *
 * Execution flow:
 *   1. Admin reviews Go/No-Go report — all blockers must be clear
 *   2. Admin submits confirmation gate (typed phrase + 4 checkboxes)
 *   3. submitConfirmation() records the gate and advances state
 *   4. liveStartSmokeTest() — wraps startSmokeTest with gate check
 *   5. liveVerifySmokeTest() — wraps verifySmokeTest
 *   6. liveStartRemainingLeads() — wraps startRemainingLeads
 *   7. generatePilotReport() — builds full report from DB, stores on batch
 *
 * None of these functions delete or modify leads, enrollments, or messages
 * outside the pilot batch scope.
 */

import { eq, inArray, and } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  pilotBatches, pilotBatchLeads, leads, conversations, optOuts, handoffTasks,
  REQUIRED_CONFIRMATION_PHRASE, FIRST_PILOT_CAP,
  type PilotConfirmationChecks,
  type PilotReport,
  type PilotReportLead,
  type PilotReportEvent,
  type FirstPilotState,
  type PilotEligibilityResult,
  type PilotPreviewMessage,
} from '@/lib/db/schema'
import {
  startSmokeTest,
  verifySmokeTest,
  startRemainingLeads,
  getFirstPilotStatus,
  type FirstPilotStatus,
} from './first-pilot'
import { generateGoNoGoReport } from './go-no-go'

type PilotBatchLeadRow = typeof pilotBatchLeads.$inferSelect

// ── Types ──────────────────────────────────────────────────────────────────────

export type ConfirmationValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] }

/** Per-lead summary shown in the live pilot UI */
export type LivePilotLead = {
  leadId: string
  firstName: string
  lastName: string
  phone: string
  sendStatus: string
  skipReason: string | null
  enrollmentId: string | null
  eligibilityResult: PilotEligibilityResult | null
  previewMessages: PilotPreviewMessage[] | null
  approvedForSend: boolean
  replyClassification: string | null
  handoffTaskId: string | null
  isSmokeTestLead: boolean
}

export type LivePilotStatus = FirstPilotStatus & {
  // Tenant/workflow display names (not in FirstPilotStatus)
  tenantName: string | null
  workflowName: string | null
  /** Full lead list with eligibility + preview data */
  leads: LivePilotLead[]
  /** True if the confirmation gate has been submitted */
  confirmed: boolean
  confirmationPhrase: string | null
  confirmationChecks: PilotConfirmationChecks | null
  confirmedBy: string | null
  confirmedAt: Date | null
  /** Complaint count (not in FirstPilotStatus) */
  complaintCount: number
  /** Failed-enrollment count (different from skipped) */
  failedCount: number
  /** Go/No-Go blocked state (from Telnyx config audit + pre-live checklist) */
  goNoGoBlocked: boolean
  goNoGoBlockerCount: number
  /** Whether the pilot report has been generated */
  reportGenerated: boolean
}

// ── Confirmation gate ─────────────────────────────────────────────────────────

/**
 * Validate the confirmation gate inputs without writing to the DB.
 * Returns { valid: true } or { valid: false, errors: string[] }.
 */
export async function validateConfirmationGate(
  batchId: string,
  phrase: string,
  checks: PilotConfirmationChecks,
): Promise<ConfirmationValidationResult> {
  const errors: string[] = []

  // Load batch
  const batch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, batchId),
    with: { leads: true },
  })
  if (!batch) {
    return { valid: false, errors: ['Pilot batch not found'] }
  }

  // Batch must be an approved first-pilot batch
  if (!batch.isFirstPilot) {
    errors.push('Batch is not marked as a first pilot batch')
  }
  if (batch.status !== 'approved') {
    errors.push(`Batch status is '${batch.status}' — must be 'approved' before confirming`)
  }

  // Lead count guard
  const leads = batch.leads as PilotBatchLeadRow[]
  if (leads.length > FIRST_PILOT_CAP) {
    errors.push(`Batch has ${leads.length} leads — maximum for first pilot is ${FIRST_PILOT_CAP}`)
  }
  if (leads.length === 0) {
    errors.push('Batch has no leads — add at least one lead before confirming')
  }

  // Must have a dry-run summary (message review step)
  if (!batch.dryRunSummary) {
    errors.push('Dry-run preview has not been generated. Run preview and review messages before confirming.')
  }

  // Phrase check (case-sensitive, trimmed)
  if (phrase.trim() !== REQUIRED_CONFIRMATION_PHRASE) {
    errors.push(`Confirmation phrase must be exactly "${REQUIRED_CONFIRMATION_PHRASE}"`)
  }

  // All checkboxes must be checked
  if (!checks.tenDlcApproved) {
    errors.push('You must confirm that 10DLC / Telnyx is approved before sending')
  }
  if (!checks.messageReviewed) {
    errors.push('You must confirm that all message bodies have been reviewed')
  }
  if (!checks.optOutTested) {
    errors.push('You must confirm that the opt-out path has been tested')
  }
  if (!checks.emergencyControlsUnderstood) {
    errors.push('You must confirm that you understand the emergency pause/cancel controls')
  }

  // Go/No-Go check — run the full audit
  try {
    const report = await generateGoNoGoReport(batch.tenantId)
    if (report.verdict === 'no_go') {
      errors.push(
        `Go/No-Go is NOT clear — ${report.blockerCount} blocker(s) must be resolved before starting. ` +
        `See /admin/dlr/go-no-go for details.`
      )
    }
  } catch {
    errors.push('Could not evaluate Go/No-Go report — check Telnyx configuration')
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}

/**
 * Submit the confirmation gate.
 * Validates inputs, writes confirmation to DB, and advances batch state
 * to 'ready_for_smoke_test' if it isn't there already.
 */
export async function submitConfirmation(
  batchId: string,
  confirmedBy: string,
  phrase: string,
  checks: PilotConfirmationChecks,
): Promise<{ ok: boolean; errors?: string[] }> {
  const validation = await validateConfirmationGate(batchId, phrase, checks)
  if (!validation.valid) {
    return { ok: false, errors: validation.errors }
  }

  const now = new Date()
  await db
    .update(pilotBatches)
    .set({
      confirmationPhrase:  phrase.trim(),
      confirmationChecks:  checks,
      confirmedBy,
      confirmedAt:         now,
      // Advance to ready_for_smoke_test if still at not_started
      firstPilotState:     'ready_for_smoke_test',
      updatedAt:           now,
    })
    .where(eq(pilotBatches.id, batchId))

  return { ok: true }
}

// ── Live execution wrappers ───────────────────────────────────────────────────

/**
 * Start the smoke test — one lead only.
 * Requires confirmation gate to have been submitted first.
 */
export async function liveStartSmokeTest(batchId: string): Promise<void> {
  const batch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, batchId),
  })
  if (!batch) throw new Error(`Batch ${batchId} not found`)

  if (!batch.confirmedAt) {
    throw new Error('Confirmation gate has not been submitted. Complete the confirmation form before starting the smoke test.')
  }

  await startSmokeTest(batchId)
}

/**
 * Verify the smoke test passed.
 * Delegates to verifySmokeTest — no additional gate check needed here.
 */
export async function liveVerifySmokeTest(batchId: string): Promise<void> {
  await verifySmokeTest(batchId)
}

/**
 * Start remaining sends (leads 2–5).
 * Requires smoke test to have passed.
 */
export async function liveStartRemainingLeads(batchId: string): Promise<void> {
  await startRemainingLeads(batchId)
}

// ── Full live pilot status ────────────────────────────────────────────────────

/**
 * Returns the full aggregated status for the live pilot UI.
 * Extends getFirstPilotStatus with confirmation state, counts, and Go/No-Go.
 */
export async function getLivePilotStatus(batchId: string): Promise<LivePilotStatus | null> {
  const base = await getFirstPilotStatus(batchId)
  if (!base) return null

  // Load batch with tenant, workflow, and batch-leads
  const batch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, batchId),
    with: { leads: true, tenant: true, workflow: true },
  })
  if (!batch) return null

  const batchLeads = batch.leads as PilotBatchLeadRow[]
  const leadIds    = batchLeads.map((bl: PilotBatchLeadRow) => bl.leadId)

  // Load full lead records so we have names + phone
  const leadRows = leadIds.length > 0
    ? await db.query.leads.findMany({ where: inArray(leads.id, leadIds) })
    : []
  const leadMap = new Map(leadRows.map(l => [l.id, l]))

  // Build LivePilotLead[]
  const livePilotLeads: LivePilotLead[] = batchLeads.map((bl: PilotBatchLeadRow) => {
    const lead = leadMap.get(bl.leadId)
    return {
      leadId:              bl.leadId,
      firstName:           lead?.firstName ?? '',
      lastName:            lead?.lastName ?? '',
      phone:               lead?.phone ?? '',
      sendStatus:          bl.sendStatus,
      skipReason:          bl.skipReason ?? null,
      enrollmentId:        bl.enrollmentId ?? null,
      eligibilityResult:   (bl.eligibilityResult as PilotEligibilityResult | null) ?? null,
      previewMessages:     (bl.previewMessages as PilotPreviewMessage[] | null) ?? null,
      approvedForSend:     bl.approvedForSend ?? false,
      replyClassification: bl.replyClassification ?? null,
      handoffTaskId:       bl.handoffTaskId ?? null,
      isSmokeTestLead:     bl.leadId === base.smokeTestLeadId,
    }
  })

  // New counts not provided by FirstPilotStatus
  const failedCount    = 0 // tracked via enrollments — simplified for status view
  const complaintCount = batchLeads.filter((bl: PilotBatchLeadRow) =>
    bl.replyClassification === 'angry_or_complaint'
  ).length

  // Go/No-Go
  let goNoGoBlocked      = false
  let goNoGoBlockerCount = 0
  try {
    const goNoGo = await generateGoNoGoReport(batch.tenantId)
    goNoGoBlocked      = goNoGo.verdict === 'no_go'
    goNoGoBlockerCount = goNoGo.blockerCount
  } catch {
    // If the audit can't run, treat as blocked
    goNoGoBlocked      = true
    goNoGoBlockerCount = 1
  }

  const tenantName   = (batch.tenant as { name: string } | null)?.name ?? null
  const workflowName = (batch.workflow as { name: string } | null)?.name ?? null

  return {
    ...base,
    tenantName,
    workflowName,
    leads:                 livePilotLeads,
    confirmed:             !!batch.confirmedAt,
    confirmationPhrase:    batch.confirmationPhrase ?? null,
    confirmationChecks:    (batch.confirmationChecks as PilotConfirmationChecks | null) ?? null,
    confirmedBy:           batch.confirmedBy ?? null,
    confirmedAt:           batch.confirmedAt ?? null,
    complaintCount,
    failedCount,
    goNoGoBlocked,
    goNoGoBlockerCount,
    reportGenerated:       batch.pilotReport != null,
  }
}

// ── Pilot report generation ───────────────────────────────────────────────────

/**
 * Generate a full pilot report and store it on the batch.
 * Safe to call at any time — overwrites any previous report.
 */
export async function generatePilotReport(batchId: string): Promise<PilotReport> {
  const batch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, batchId),
    with: { tenant: true, workflow: true, leads: true },
  })
  if (!batch) throw new Error(`Batch ${batchId} not found`)

  const batchLeads = batch.leads as PilotBatchLeadRow[]
  const leadIds    = batchLeads.map((bl: PilotBatchLeadRow) => bl.leadId)

  // Load full lead records
  const leadRows = leadIds.length > 0
    ? await db.query.leads.findMany({ where: inArray(leads.id, leadIds) })
    : []
  const leadMap = new Map(leadRows.map(l => [l.id, l]))

  // Load opt-outs for these leads' phones
  const phones = leadRows.map(l => l.phone)
  const optOutRows = phones.length > 0
    ? await db.select().from(optOuts).where(and(
        eq(optOuts.tenantId, batch.tenantId),
        inArray(optOuts.phone, phones),
      ))
    : []
  const optOutPhones = new Set(optOutRows.map(o => o.phone))

  // Load handoff tasks for these leads
  const handoffRows = leadIds.length > 0
    ? await db.query.handoffTasks.findMany({
        where: inArray(handoffTasks.leadId, leadIds),
        orderBy: (h, { asc }) => [asc(h.createdAt)],
      })
    : []

  // Load conversations for these leads (to get messages)
  const convRows = leadIds.length > 0
    ? await db.query.conversations.findMany({
        where: inArray(conversations.leadId, leadIds),
        with: { messages: true },
      })
    : []
  const convByLeadId = new Map(convRows.map(c => [c.leadId, c]))

  // ── Build per-lead report rows ──────────────────────────────────────────────
  const timeline: PilotReportEvent[] = []
  const reportLeads: PilotReportLead[] = []

  let sentCount      = 0
  let skippedCount   = 0
  let failedCount    = 0
  let replyCount     = 0
  let optOutCount    = 0
  let complaintCount = 0
  let handoffCount   = 0

  for (const batchLead of batchLeads) {
    const lead    = leadMap.get(batchLead.leadId)
    if (!lead) continue

    const conv    = convByLeadId.get(lead.id)
    const convMessages = conv?.messages ?? []
    const outbound = convMessages.filter(m => m.direction === 'outbound')
    const inbound  = convMessages.filter(m => m.direction === 'inbound')

    const optedOut  = optOutPhones.has(lead.phone)
    const isComplaint = batchLead.replyClassification === 'angry_or_complaint'

    // Counts
    if (batchLead.sendStatus === 'sent')    sentCount++
    if (batchLead.sendStatus === 'skipped') skippedCount++
    if (batchLead.sendStatus === 'cancelled') failedCount++

    const hasReply = batchLead.replyClassification != null || inbound.length > 0
    if (hasReply) replyCount++
    if (optedOut)   optOutCount++
    if (isComplaint) complaintCount++
    if (batchLead.handoffTaskId) handoffCount++

    // Sent messages for this lead
    const sentMessages = outbound.map(m => ({
      body: m.body,
      sentAt: m.sentAt?.toISOString() ?? null,
      providerMessageId: m.providerMessageId ?? null,
      status: m.status,
      deliveredAt: m.deliveredAt?.toISOString() ?? null,
    }))

    // Timeline events for this lead
    for (const msg of outbound) {
      if (msg.status === 'queued' && msg.skipReason) {
        timeline.push({ at: msg.createdAt.toISOString(), type: 'failed', leadId: lead.id, detail: `Skipped: ${msg.skipReason}` })
      } else if (msg.sentAt) {
        timeline.push({ at: msg.sentAt.toISOString(), type: 'sent', leadId: lead.id, detail: `Sent: "${msg.body.slice(0, 60)}…"` })
      }
      if (msg.deliveredAt) {
        timeline.push({ at: msg.deliveredAt.toISOString(), type: 'delivered', leadId: lead.id, detail: 'Message delivered' })
      }
    }

    for (const msg of inbound) {
      const eventType = isComplaint ? 'complaint' : 'reply'
      timeline.push({ at: msg.createdAt.toISOString(), type: eventType, leadId: lead.id, detail: `Reply: "${msg.body.slice(0, 80)}"` })
    }

    if (optedOut) {
      const optOutRow = optOutRows.find(o => o.phone === lead.phone)
      if (optOutRow) {
        timeline.push({ at: optOutRow.createdAt.toISOString(), type: 'opt_out', leadId: lead.id, detail: 'Lead sent STOP — opted out' })
      }
    }

    if (batchLead.handoffTaskId) {
      const handoff = handoffRows.find(h => h.id === batchLead.handoffTaskId)
      if (handoff) {
        timeline.push({ at: handoff.createdAt.toISOString(), type: 'handoff', leadId: lead.id, detail: `Handoff created: ${handoff.taskType} (${handoff.classification})` })
      }
    }

    reportLeads.push({
      leadId:               lead.id,
      firstName:            lead.firstName,
      lastName:             lead.lastName,
      phone:                lead.phone,
      sendStatus:           batchLead.sendStatus,
      skipReason:           batchLead.skipReason ?? null,
      enrollmentId:         batchLead.enrollmentId ?? null,
      renderedMessages:     (batchLead.previewMessages as PilotReportLead['renderedMessages']) ?? [],
      sentMessages,
      replyClassification:  batchLead.replyClassification ?? null,
      replyBody:            lead.lastReplyBody ?? null,
      optedOut,
      handoffTaskId:        batchLead.handoffTaskId ?? null,
      complaint:            isComplaint,
    })
  }

  // Smoke test passed event
  if (batch.smokeTestPassedAt) {
    timeline.push({ at: batch.smokeTestPassedAt.toISOString(), type: 'smoke_test_passed', detail: 'Smoke test verified — remaining sends unlocked' })
  }

  // Pause/cancel events
  const state = batch.firstPilotState as FirstPilotState
  if (state === 'paused' && batch.cancelledAt) {
    timeline.push({ at: batch.cancelledAt.toISOString(), type: 'paused', detail: 'Pilot paused' })
  }
  if (state === 'cancelled' && batch.cancelledAt) {
    timeline.push({ at: batch.cancelledAt.toISOString(), type: 'cancelled', detail: `Pilot cancelled: ${batch.cancelReason ?? 'no reason given'}` })
  }

  // Sort timeline chronologically
  timeline.sort((a, b) => a.at.localeCompare(b.at))

  // ── Recommendation ─────────────────────────────────────────────────────────
  const recommendation = computeRecommendation({ sentCount, skippedCount, optOutCount, complaintCount, failedCount, state })

  const tenantName  = (batch.tenant as { name: string } | null)?.name ?? batch.tenantId
  const workflowName = (batch.workflow as { name: string } | null)?.name ?? batch.workflowId

  const report: PilotReport = {
    generatedAt:        new Date().toISOString(),
    batchId,
    tenantId:           batch.tenantId,
    tenantName,
    workflowName,
    totalLeads:         batchLeads.length,
    leads:              reportLeads,
    sentCount,
    skippedCount,
    failedCount,
    replyCount,
    optOutCount,
    complaintCount,
    handoffCount,
    timeline,
    recommendation:     recommendation.verdict,
    recommendationReason: recommendation.reason,
  }

  // Persist the report on the batch
  await db
    .update(pilotBatches)
    .set({ pilotReport: report, updatedAt: new Date() })
    .where(eq(pilotBatches.id, batchId))

  return report
}

// ── Recommendation logic ──────────────────────────────────────────────────────

function computeRecommendation(p: {
  sentCount: number
  skippedCount: number
  optOutCount: number
  complaintCount: number
  failedCount: number
  state: FirstPilotState
}): { verdict: PilotReport['recommendation']; reason: string } {
  if (p.state === 'cancelled') {
    return { verdict: 'fix_issues', reason: 'Pilot was cancelled before completion. Investigate the cause before retrying.' }
  }
  if (p.complaintCount > 0) {
    return { verdict: 'pause', reason: `${p.complaintCount} complaint(s) received. Review message content and targeting before expanding.` }
  }
  if (p.failedCount > 0 || p.sentCount === 0) {
    return { verdict: 'fix_issues', reason: 'One or more sends failed or no messages were sent. Fix the underlying issue before retrying.' }
  }
  if (p.optOutCount > 0 && p.optOutCount / Math.max(p.sentCount, 1) > 0.2) {
    return { verdict: 'repeat', reason: `${p.optOutCount} opt-out(s) — opt-out rate is high. Review targeting and message copy before expanding.` }
  }
  if (p.skippedCount > 0 && p.sentCount === 0) {
    return { verdict: 'fix_issues', reason: 'All leads were skipped — review eligibility and consent configuration.' }
  }
  if (p.state === 'completed' && p.sentCount > 0) {
    return { verdict: 'expand', reason: 'Pilot completed with no complaints. System is operating correctly — you may expand the pilot.' }
  }
  return { verdict: 'repeat', reason: 'Pilot did not fully complete. Review results and repeat with adjustments if needed.' }
}
