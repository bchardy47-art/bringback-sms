/**
 * Phase 9 — Pilot Dry-Run Preview
 *
 * Generates a full dry-run preview of a pilot batch: renders all outbound
 * message templates for each lead against real lead data, checks eligibility,
 * and returns a structured summary — without touching Telnyx or creating any
 * enrollments.
 *
 * The result is stored in pilot_batches.dry_run_summary and
 * pilot_batch_leads.preview_messages.
 */

import { eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { leads, pilotBatchLeads, pilotBatches, tenants, workflowSteps, workflows } from '@/lib/db/schema'

type PilotBatchLeadRow = typeof pilotBatchLeads.$inferSelect
import { renderTemplate, previewWorkflow } from '@/lib/workflows/preview'
import { checkLeadEligibility } from './eligibility'
import type {
  PilotDryRunSummary,
  PilotPreviewMessage,
  SendSmsConfig,
} from '@/lib/db/schema'

// ── Types ──────────────────────────────────────────────────────────────────────

export type PreviewResult = {
  batchId: string
  summary: PilotDryRunSummary
  eligibleCount: number
  ineligibleCount: number
}

// ── Main ───────────────────────────────────────────────────────────────────────

/**
 * Run a full dry-run preview for a pilot batch.
 *
 * - Loads all leads in the batch
 * - Checks eligibility for each
 * - Renders all workflow send_sms steps against each lead's real data
 * - Persists results to pilot_batch_leads and pilot_batches.dry_run_summary
 * - Advances batch status to 'previewed'
 *
 * Safe to call multiple times — re-running overwrites the previous preview.
 */
export async function runBatchPreview(batchId: string): Promise<PreviewResult> {
  // Load batch + workflow
  const batch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, batchId),
    with: { leads: true },
  })
  if (!batch) throw new Error(`Pilot batch ${batchId} not found`)

  // Load workflow steps
  const wf = await db.query.workflows.findFirst({
    where: eq(workflows.id, batch.workflowId),
    with: { steps: { orderBy: [workflowSteps.position] } },
  })
  if (!wf) throw new Error(`Workflow ${batch.workflowId} not found`)

  // Load full lead records
  const leadIds = batch.leads.map((bl: PilotBatchLeadRow) => bl.leadId)
  const leadRows = leadIds.length > 0
    ? await db.query.leads.findMany({ where: inArray(leads.id, leadIds) })
    : []
  const leadMap = new Map(leadRows.map(l => [l.id, l]))

  const summaryLeads: PilotDryRunSummary['leads'] = []
  let eligibleCount = 0
  let ineligibleCount = 0

  for (const batchLead of batch.leads) {
    const lead = leadMap.get(batchLead.leadId)
    if (!lead) continue

    // Eligibility check
    const eligibilityResult = await checkLeadEligibility(lead, batch.tenantId, batch.workflowId)

    // Render messages (even for ineligible leads — preview is informational)
    const context = {
      firstName: lead.firstName,
      lastName: lead.lastName,
      dealershipName: lead.tenantId, // will be replaced with tenant name in a moment
      vehicleOfInterest: lead.vehicleOfInterest ?? null,
      salespersonName: lead.salespersonName ?? null,
    }

    // Get tenant name for dealershipName merge field
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, batch.tenantId) })
    const mergeContext = { ...context, dealershipName: tenant?.name ?? 'Your Dealership' }

    const stepPreviews = previewWorkflow(
      wf.steps.map(s => ({ position: s.position, type: s.type, config: s.config as SendSmsConfig })),
      mergeContext
    )

    const previewMessages: PilotPreviewMessage[] = stepPreviews.map(sp => ({
      position: sp.position,
      type: sp.type,
      rendered: sp.rendered,
      usedFallback: sp.usedFallback,
      delayHours: sp.delayHours,
      label: sp.label,
    }))

    // Update pilot_batch_leads row
    const now = new Date()
    await db
      .update(pilotBatchLeads)
      .set({
        eligibilityResult,
        previewMessages,
        approvedForSend: eligibilityResult.eligible,
        sendStatus: eligibilityResult.eligible ? 'pending' : 'skipped',
        skipReason: eligibilityResult.eligible ? null : eligibilityResult.reason,
        updatedAt: now,
      })
      .where(eq(pilotBatchLeads.id, batchLead.id))

    if (eligibilityResult.eligible) {
      eligibleCount++
    } else {
      ineligibleCount++
    }

    summaryLeads.push({
      leadId: lead.id,
      firstName: lead.firstName,
      lastName: lead.lastName,
      eligible: eligibilityResult.eligible,
      skipReason: eligibilityResult.reason,
      messages: previewMessages,
    })
  }

  const summary: PilotDryRunSummary = {
    generatedAt: new Date().toISOString(),
    eligibleCount,
    ineligibleCount,
    leads: summaryLeads,
  }

  // Persist summary + advance status
  await db
    .update(pilotBatches)
    .set({
      dryRunSummary: summary,
      blockedCount: ineligibleCount,
      status: 'previewed',
      updatedAt: new Date(),
    })
    .where(eq(pilotBatches.id, batchId))

  return { batchId, summary, eligibleCount, ineligibleCount }
}
