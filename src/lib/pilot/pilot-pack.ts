/**
 * Phase 16 — Pilot Data Pack + 10DLC Waiting Room
 *
 * Aggregates everything needed to review, export, and approve the first SMS pilot:
 *   - Full tenant / workflow / batch / lead data
 *   - Readiness score (0–100) with breakdown
 *   - 10DLC waiting room status
 *   - CSV / JSON / Markdown export functions
 *
 * SAFETY INVARIANTS:
 *   - No enrollments created
 *   - No Telnyx / SMS calls made
 *   - Batch status is never changed
 *   - Live SMS remains fully locked down
 */

import { and, eq, ne } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  tenants, workflows, workflowSteps, pilotBatches, pilotBatchLeads, leads,
  pilotLeadImports,
  FIRST_PILOT_CAP,
  type TenDLCWaitingStatus,
  type PilotReadinessScore,
  type ReadinessBreakdown,
  type PilotImportDryRunReport,
  type PilotPreviewMessage,
} from '@/lib/db/schema'
import { generateDryRunReport } from '@/lib/pilot/lead-import-review'

// ── Public data type ──────────────────────────────────────────────────────────

export type PilotPackData = {
  tenant:         typeof tenants.$inferSelect | null
  workflow:       typeof workflows.$inferSelect | null
  workflowStepCount: number
  batch:          typeof pilotBatches.$inferSelect | null
  batchLeads:     Array<typeof pilotBatchLeads.$inferSelect>
  batchLeadDetails: Array<typeof leads.$inferSelect>      // lead records for batch leads
  importedLeads:  Array<typeof pilotLeadImports.$inferSelect>
  selectedLeads:  Array<typeof pilotLeadImports.$inferSelect>
  dryRunReport:   PilotImportDryRunReport | null
  readinessScore: PilotReadinessScore
  tenDLCWaitingStatus: TenDLCWaitingStatus
}

// ── Main data loader ──────────────────────────────────────────────────────────

export async function getPilotPackData(tenantId: string): Promise<PilotPackData> {
  // Load tenant
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }) ?? null

  // Load the most recent first-pilot batch for this tenant
  const batchRows = await db
    .select()
    .from(pilotBatches)
    .where(and(eq(pilotBatches.tenantId, tenantId), eq(pilotBatches.isFirstPilot, true)))
    .orderBy(pilotBatches.createdAt)
    .limit(1)
  const batch = batchRows[0] ?? null

  // Load workflow for this batch (or the most recent active workflow)
  let workflow: typeof workflows.$inferSelect | null = null
  let workflowStepCount = 0
  if (batch?.workflowId) {
    workflow = await db.query.workflows.findFirst({ where: eq(workflows.id, batch.workflowId) }) ?? null
    if (workflow) {
      const steps = await db.select().from(workflowSteps).where(eq(workflowSteps.workflowId, workflow.id))
      workflowStepCount = steps.filter(s => s.type === 'send_sms').length
    }
  }

  // Batch leads + lead records
  const batchLeads = batch
    ? await db.select().from(pilotBatchLeads).where(eq(pilotBatchLeads.batchId, batch.id))
    : []
  const batchLeadDetails: Array<typeof leads.$inferSelect> = []
  for (const bl of batchLeads) {
    const lead = await db.query.leads.findFirst({ where: eq(leads.id, bl.leadId) })
    if (lead) batchLeadDetails.push(lead)
  }

  // Import rows
  const importedLeads = await db
    .select()
    .from(pilotLeadImports)
    .where(and(
      eq(pilotLeadImports.tenantId, tenantId),
      ne(pilotLeadImports.importStatus, 'excluded'),
    ))
    .orderBy(pilotLeadImports.createdAt)

  const selectedLeads = importedLeads.filter(r => r.importStatus === 'selected')

  // Dry-run report (catch errors gracefully)
  let dryRunReport: PilotImportDryRunReport | null = null
  try {
    dryRunReport = await generateDryRunReport(tenantId)
  } catch {
    dryRunReport = null
  }

  // Compute derived values
  const readinessScore    = computeReadinessScore(tenant, workflow, selectedLeads, dryRunReport)
  const tenDLCWaitingStatus = getTenDLCWaitingStatus(tenant, batch, selectedLeads, dryRunReport)

  return {
    tenant,
    workflow,
    workflowStepCount,
    batch,
    batchLeads,
    batchLeadDetails,
    importedLeads,
    selectedLeads,
    dryRunReport,
    readinessScore,
    tenDLCWaitingStatus,
  }
}

// ── Readiness Score ───────────────────────────────────────────────────────────

export function computeReadinessScore(
  tenant:       typeof tenants.$inferSelect | null,
  workflow:     typeof workflows.$inferSelect | null,
  selectedLeads: Array<typeof pilotLeadImports.$inferSelect>,
  dryRunReport: PilotImportDryRunReport | null,
): PilotReadinessScore {
  const blockers: string[] = []
  const warnings: string[] = []
  const total = selectedLeads.length

  // ── 1. Lead data completeness (0–15) ─────────────────────────────────────
  let leadDataCompleteness = 0
  if (total > 0) {
    const withPhone     = selectedLeads.filter(r => r.phone && r.phone.startsWith('+')).length
    const withFirstName = selectedLeads.filter(r => r.firstName.trim().length > 0).length
    const withEmail     = selectedLeads.filter(r => r.email).length
    const baseScore     = ((withPhone + withFirstName) / (total * 2)) * 12
    const emailBonus    = (withEmail / total) * 3
    leadDataCompleteness = Math.round(Math.min(15, baseScore + emailBonus))
  }
  if (total === 0) {
    blockers.push('No leads selected for the pilot batch')
  }

  // ── 2. Consent coverage (0–20) ────────────────────────────────────────────
  let consentCoverage = 0
  if (total > 0) {
    const coverage = dryRunReport?.consentCoverage ?? {}
    const explicitCount = coverage['explicit'] ?? 0
    const impliedCount  = coverage['implied']  ?? 0
    const revokedCount  = coverage['revoked']  ?? 0

    if (revokedCount > 0) {
      blockers.push(`${revokedCount} lead${revokedCount > 1 ? 's' : ''} with revoked consent — must be excluded`)
    }
    consentCoverage = Math.round(
      Math.min(20, (explicitCount / total) * 20 + (impliedCount / total) * 10)
    )
    if (consentCoverage < 10) {
      warnings.push('Low consent coverage — verify consent documentation before sending')
    }
  }

  // ── 3. Preview completeness (0–15) ────────────────────────────────────────
  let previewCompleteness = 0
  if (total > 0) {
    const withPreviews = selectedLeads.filter(r => {
      const p = r.previewMessages as PilotPreviewMessage[] | null
      return p && p.length > 0
    }).length
    previewCompleteness = Math.round((withPreviews / total) * 15)
    if (withPreviews < total) {
      warnings.push(`${total - withPreviews} selected lead${total - withPreviews > 1 ? 's' : ''} missing message previews — render previews before batch creation`)
    }
  }

  // ── 4. No blockers (0–15) ────────────────────────────────────────────────
  let noBlockers = 0
  const blockedCount = dryRunReport?.blockedCount ?? 0
  const warningCount = dryRunReport?.warningCount ?? 0
  if (blockedCount === 0 && warningCount === 0) {
    noBlockers = 15
  } else if (blockedCount === 0) {
    noBlockers = 10
    warnings.push(`${warningCount} lead${warningCount > 1 ? 's' : ''} have warnings — review before sending`)
  } else {
    noBlockers = 0
    blockers.push(`${blockedCount} lead${blockedCount > 1 ? 's' : ''} are blocked — resolve or exclude before creating a batch`)
  }

  // ── 5. Workflow approval (0–10) ──────────────────────────────────────────
  let workflowApproval = 0
  if (!workflow) {
    blockers.push('No workflow assigned to the pilot batch')
  } else if (workflow.approvedForLive) {
    workflowApproval = 10
  } else {
    workflowApproval = 5
    warnings.push(`Workflow "${workflow.name}" is not yet approved for live sends`)
  }

  // ── 6. 10DLC readiness (0–15) ────────────────────────────────────────────
  let tenDlcReadiness = 0
  const dlcStatus = tenant?.tenDlcStatus ?? 'not_started'
  if (dlcStatus === 'approved' || dlcStatus === 'exempt' || dlcStatus === 'dev_override') {
    tenDlcReadiness = 15
  } else if (dlcStatus === 'pending') {
    tenDlcReadiness = 10
    warnings.push('10DLC registration is pending — cannot send until approved')
  } else {
    // Check how many brand fields are filled
    const brandFieldsFilled = [
      tenant?.businessLegalName, tenant?.businessAddress, tenant?.businessWebsite,
      tenant?.privacyPolicyUrl, tenant?.termsUrl,
    ].filter(Boolean).length
    tenDlcReadiness = Math.round((brandFieldsFilled / 5) * 7)
    if (tenDlcReadiness < 4) {
      blockers.push('10DLC registration not started — complete brand registration fields')
    } else {
      warnings.push('10DLC registration not submitted — fill remaining fields and submit')
    }
  }

  // ── 7. Compliance health (0–10) ──────────────────────────────────────────
  let complianceHealth = 0
  if (tenant?.complianceBlocked) {
    complianceHealth = 0
    blockers.push(`Compliance block active: ${tenant.complianceBlockReason ?? 'reason not set'}`)
  } else if (!tenant?.smsSendingNumber) {
    complianceHealth = 5
    warnings.push('No SMS sending number configured for this tenant')
  } else {
    complianceHealth = 10
  }

  const score = leadDataCompleteness + consentCoverage + previewCompleteness +
    noBlockers + workflowApproval + tenDlcReadiness + complianceHealth

  let status: PilotReadinessScore['status']
  if (score >= 86)       status = 'ready'
  else if (score >= 66)  status = 'needs_attention'
  else if (score >= 41)  status = 'in_progress'
  else                   status = 'not_started'

  // Recommended next action
  let recommendedNextAction: string
  if (blockers.length > 0) {
    recommendedNextAction = `Resolve blocker: ${blockers[0]}`
  } else if (dlcStatus !== 'approved' && dlcStatus !== 'exempt' && dlcStatus !== 'dev_override') {
    recommendedNextAction = 'Complete 10DLC registration and wait for carrier approval'
  } else if (warnings.length > 0) {
    recommendedNextAction = `Address warning: ${warnings[0]}`
  } else {
    recommendedNextAction = 'All systems ready — proceed to pilot batch approval'
  }

  return {
    score,
    status,
    blockers,
    warnings,
    recommendedNextAction,
    breakdown: {
      leadDataCompleteness,
      consentCoverage,
      previewCompleteness,
      noBlockers,
      workflowApproval,
      tenDlcReadiness,
      complianceHealth,
    },
  }
}

// ── 10DLC Waiting Room Status ─────────────────────────────────────────────────

export function getTenDLCWaitingStatus(
  tenant:        typeof tenants.$inferSelect | null,
  batch:         typeof pilotBatches.$inferSelect | null,
  selectedLeads: Array<typeof pilotLeadImports.$inferSelect>,
  dryRunReport:  PilotImportDryRunReport | null,
): TenDLCWaitingStatus {
  if (!tenant) return 'missing_tenant_info'

  // 1. Compliance hard block
  if (tenant.complianceBlocked) return 'missing_tenant_info'

  // 2. Brand registration fields present?
  const requiredBrandFields = [
    tenant.businessLegalName,
    tenant.businessAddress,
    tenant.smsSendingNumber,
  ]
  if (requiredBrandFields.some(f => !f)) return 'missing_tenant_info'

  // 3. Pilot batch + leads present?
  if (selectedLeads.length === 0) return 'pilot_batch_not_ready'
  if (!batch) return 'pilot_batch_not_ready'

  // 4. Consent data present?
  const coverage = dryRunReport?.consentCoverage ?? {}
  const hasConsent = (coverage['explicit'] ?? 0) + (coverage['implied'] ?? 0) > 0
  const allUnknown = selectedLeads.every(r => !r.consentStatus || r.consentStatus === 'unknown')
  if (allUnknown || !hasConsent) return 'missing_consent_data'

  // 5. Is 10DLC approved?
  const dlcStatus = tenant.tenDlcStatus
  const brandApproved    = tenant.brandStatus    === 'approved'
  const campaignApproved = tenant.campaignStatus === 'approved'

  if (
    dlcStatus === 'approved' ||
    dlcStatus === 'exempt' ||
    dlcStatus === 'dev_override' ||
    (brandApproved && campaignApproved)
  ) {
    return 'ready_for_live_pilot'
  }

  // 6. Everything else ready, waiting on 10DLC
  const blockedCount = dryRunReport?.blockedCount ?? 0
  if (blockedCount > 0) return 'pilot_batch_not_ready'

  if (dlcStatus === 'pending' || brandApproved) return 'ready_when_approved'

  return 'waiting_on_10dlc'
}

// ── CSV / Export helpers ──────────────────────────────────────────────────────

/**
 * Export selected leads as a CSV string.
 * Only includes leads with importStatus = 'selected'.
 */
export async function exportLeadsCSV(tenantId: string): Promise<string> {
  const rows = await db
    .select()
    .from(pilotLeadImports)
    .where(and(
      eq(pilotLeadImports.tenantId, tenantId),
      eq(pilotLeadImports.importStatus, 'selected'),
    ))

  const headers = [
    'firstName', 'lastName', 'phone', 'phoneRaw', 'email',
    'vehicleOfInterest', 'consentStatus', 'consentSource',
    'leadSource', 'crmSource', 'externalId',
    'importStatus', 'reviewed', 'reviewedBy',
    'blockedReasons', 'warnings',
  ]

  const csvEscape = (v: unknown): string => {
    const s = v == null ? '' : String(v)
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  const lines = [headers.join(',')]
  for (const r of rows) {
    lines.push([
      r.firstName, r.lastName, r.phone ?? '', r.phoneRaw, r.email ?? '',
      r.vehicleOfInterest ?? '', r.consentStatus, r.consentSource ?? '',
      r.leadSource ?? '', r.crmSource ?? '', r.externalId ?? '',
      r.importStatus, String(r.reviewed), r.reviewedBy ?? '',
      JSON.stringify(r.blockedReasons ?? []),
      JSON.stringify(r.warnings ?? []),
    ].map(csvEscape).join(','))
  }
  return lines.join('\n')
}

/**
 * Export message previews as a CSV.
 * One row per (lead × message step).
 * Includes opt-out footer detection.
 */
export async function exportPreviewsCSV(tenantId: string): Promise<string> {
  const rows = await db
    .select()
    .from(pilotLeadImports)
    .where(and(
      eq(pilotLeadImports.tenantId, tenantId),
      eq(pilotLeadImports.importStatus, 'selected'),
    ))

  const headers = [
    'leadImportId', 'firstName', 'lastName', 'phone',
    'stepPosition', 'stepLabel', 'delayHours',
    'renderedMessage', 'usedFallback', 'hasOptOutFooter',
  ]

  const csvEscape = (v: unknown): string => {
    const s = v == null ? '' : String(v)
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  const lines = [headers.join(',')]
  for (const r of rows) {
    const previews = (r.previewMessages as PilotPreviewMessage[] | null) ?? []
    if (previews.length === 0) {
      // Emit a row even for leads without previews so they're visible
      lines.push([
        r.id, r.firstName, r.lastName, r.phone ?? '',
        '', '', '', '(no preview rendered)', 'false', 'false',
      ].map(csvEscape).join(','))
    } else {
      for (const p of previews) {
        const rendered = p.rendered ?? ''
        const hasOptOut = /reply\s+stop|stop\s+to\s+(unsubscribe|opt.out)/i.test(rendered)
        lines.push([
          r.id, r.firstName, r.lastName, r.phone ?? '',
          p.position, p.label ?? `Step ${p.position}`, p.delayHours ?? 0,
          rendered, String(p.usedFallback ?? false), String(hasOptOut),
        ].map(csvEscape).join(','))
      }
    }
  }
  return lines.join('\n')
}

/**
 * Export the dry-run report as a formatted JSON string.
 */
export async function exportDryRunJSON(tenantId: string): Promise<string> {
  const report = await generateDryRunReport(tenantId)
  return JSON.stringify(report, null, 2)
}

/**
 * Export sample messages text suitable for 10DLC TCR submission.
 * Extracts unique rendered message bodies from selected leads' previews.
 * Deduplicates and annotates each with step position.
 */
export async function exportSampleMessages(tenantId: string): Promise<string> {
  const rows = await db
    .select()
    .from(pilotLeadImports)
    .where(and(
      eq(pilotLeadImports.tenantId, tenantId),
      eq(pilotLeadImports.importStatus, 'selected'),
    ))

  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })

  // Collect unique messages by step position
  const byPosition = new Map<number, { rendered: string; label: string; usedFallback: boolean }[]>()
  for (const r of rows) {
    const previews = (r.previewMessages as PilotPreviewMessage[] | null) ?? []
    for (const p of previews) {
      if (!p.rendered) continue
      const pos = p.position
      if (!byPosition.has(pos)) byPosition.set(pos, [])
      byPosition.get(pos)!.push({ rendered: p.rendered, label: p.label ?? `Step ${pos}`, usedFallback: p.usedFallback ?? false })
    }
  }

  const lines: string[] = [
    '10DLC SAMPLE MESSAGES',
    `Tenant: ${tenant?.name ?? tenantId}`,
    `Generated: ${new Date().toISOString()}`,
    `Lead count: ${rows.length}`,
    '',
    'These sample messages are submitted as part of TCR campaign registration.',
    'Each message includes an opt-out footer as required by CTIA guidelines.',
    '',
    '─'.repeat(60),
  ]

  const positions = Array.from(byPosition.keys()).sort((a, b) => a - b)
  for (const pos of positions) {
    const msgs = byPosition.get(pos)!
    const label = msgs[0].label
    lines.push(`\nSAMPLE MESSAGE — ${label.toUpperCase()}`)
    lines.push('─'.repeat(40))
    // Show up to 2 distinct messages per position (main + fallback)
    const unique = Array.from(new Map(msgs.map(m => [m.rendered.slice(0, 50), m])).values())
    for (const msg of unique.slice(0, 2)) {
      lines.push(msg.usedFallback ? '[FALLBACK TEMPLATE]' : '[MAIN TEMPLATE]')
      lines.push(msg.rendered)
      lines.push('')
    }
  }

  lines.push('─'.repeat(60))
  lines.push(`\nEND OF SAMPLE MESSAGES — ${positions.length} step${positions.length !== 1 ? 's' : ''} shown`)

  return lines.join('\n')
}

/**
 * Export a pilot launch checklist as Markdown.
 * Annotates each item with current pass/fail state from DB.
 */
export async function exportChecklist(tenantId: string): Promise<string> {
  const data = await getPilotPackData(tenantId)
  const { tenant, workflow, batch, selectedLeads, readinessScore, tenDLCWaitingStatus } = data

  const check = (pass: boolean, label: string) =>
    `- [${pass ? 'x' : ' '}] ${label}`

  const dlcStatus = tenant?.tenDlcStatus ?? 'not_started'
  const dlcApproved = ['approved', 'exempt', 'dev_override'].includes(dlcStatus)

  const lines: string[] = [
    '# Pilot Launch Checklist',
    `**Tenant:** ${tenant?.name ?? tenantId}`,
    `**Generated:** ${new Date().toISOString()}`,
    `**Readiness Score:** ${readinessScore.score}/100 (${readinessScore.status})`,
    `**10DLC Status:** ${tenDLCWaitingStatus}`,
    '',
    '## Lead Readiness',
    check(selectedLeads.length > 0, `Leads selected (${selectedLeads.length} of max ${FIRST_PILOT_CAP})`),
    check(selectedLeads.every(r => r.phone?.startsWith('+')), 'All selected leads have valid E.164 phone numbers'),
    check(selectedLeads.every(r => r.reviewed), 'All selected leads marked as reviewed'),
    check(
      selectedLeads.every(r => ['explicit', 'implied'].includes(r.consentStatus)),
      'All selected leads have explicit or implied consent',
    ),
    check(
      selectedLeads.every(r => {
        const p = r.previewMessages as PilotPreviewMessage[] | null
        return p && p.length > 0
      }),
      'All selected leads have rendered message previews',
    ),
    '',
    '## Workflow',
    check(!!workflow, `Workflow assigned: ${workflow?.name ?? 'none'}`),
    check(workflow?.approvedForLive ?? false, 'Workflow approved for live sends'),
    check(
      workflow?.activationStatus === 'approved' || workflow?.activationStatus === 'active',
      `Workflow activation status: ${workflow?.activationStatus ?? 'unknown'}`,
    ),
    '',
    '## 10DLC / Telnyx Registration',
    check(!!tenant?.businessLegalName, `Business legal name: ${tenant?.businessLegalName ?? '(missing)'}`),
    check(!!tenant?.businessAddress, 'Business address on file'),
    check(!!tenant?.businessWebsite, `Business website: ${tenant?.businessWebsite ?? '(missing)'}`),
    check(!!tenant?.privacyPolicyUrl, 'Privacy policy URL on file'),
    check(!!tenant?.termsUrl, 'Terms of service URL on file'),
    check(!!tenant?.smsTermsUrl, 'SMS-specific terms URL on file'),
    check(!!tenant?.smsSendingNumber, `Sending number: ${tenant?.smsSendingNumber ?? '(missing)'}`),
    check(tenant?.brandStatus === 'approved', `Brand status: ${tenant?.brandStatus ?? 'not_started'}`),
    check(tenant?.campaignStatus === 'approved', `Campaign status: ${tenant?.campaignStatus ?? 'not_started'}`),
    check(dlcApproved, `10DLC overall status: ${dlcStatus}`),
    '',
    '## Compliance',
    check(!(tenant?.complianceBlocked), 'No active compliance block'),
    check(!(tenant?.automationPaused), 'Automation not paused at tenant level'),
    check(tenant?.smsLiveApproved ?? false, 'SMS live sending approved by DLR admin'),
    '',
    '## Pilot Batch',
    check(!!batch, `Draft batch created: ${batch?.id?.slice(0, 8) ?? 'none'}…`),
    check(batch?.status === 'approved', `Batch status: ${batch?.status ?? 'none'}`),
    check(batch?.isFirstPilot ?? false, 'Batch flagged as first pilot'),
    '',
    '## Final Gate',
    check(tenDLCWaitingStatus === 'ready_for_live_pilot', 'Overall status: ready for live pilot'),
    check(readinessScore.score >= 86, `Readiness score ≥ 86 (current: ${readinessScore.score})`),
    '',
    '---',
    '## Blockers',
    ...(readinessScore.blockers.length > 0
      ? readinessScore.blockers.map(b => `- ❌ ${b}`)
      : ['- ✅ No blockers']),
    '',
    '## Warnings',
    ...(readinessScore.warnings.length > 0
      ? readinessScore.warnings.map(w => `- ⚠️ ${w}`)
      : ['- ✅ No warnings']),
    '',
    '## Recommended Next Action',
    `> ${readinessScore.recommendedNextAction}`,
  ]

  return lines.join('\n')
}
