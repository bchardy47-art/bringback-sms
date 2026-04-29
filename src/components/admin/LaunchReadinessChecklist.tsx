/**
 * Launch Readiness Checklist — server component.
 *
 * Shows the 6-step path to the first live pilot, each with a live
 * pass/pending/blocked badge and a link to the relevant admin page.
 * Displayed on the DLR Overview page.
 *
 * Queries only the minimal fields needed for each status check.
 * Never writes anything.
 */

import Link from 'next/link'
import { db } from '@/lib/db'
import { tenants, workflows, pilotBatches, pilotLeadImports } from '@/lib/db/schema'
import { and, eq, ne } from 'drizzle-orm'

type StepStatus = 'done' | 'pending' | 'blocked' | 'waiting'

type ChecklistStep = {
  number: number
  label:  string
  detail: string
  href:   string
  status: StepStatus
  cta:    string
}

const STATUS_STYLE: Record<StepStatus, string> = {
  done:    'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100  text-amber-700',
  blocked: 'bg-red-100    text-red-700',
  waiting: 'bg-blue-100   text-blue-700',
}

const STATUS_LABEL: Record<StepStatus, string> = {
  done:    '✓ Done',
  pending: '· In progress',
  blocked: '✗ Needs action',
  waiting: '⏳ Waiting',
}

export async function LaunchReadinessChecklist({ tenantId }: { tenantId: string }) {
  // Load the minimal data for each check in one pass
  const [tenant, workflowRows, batchRows, importRows] = await Promise.all([
    db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }),
    db.select({ id: workflows.id, approvedForLive: workflows.approvedForLive })
      .from(workflows)
      .where(eq(workflows.tenantId, tenantId))
      .limit(10),
    db.select({ id: pilotBatches.id, status: pilotBatches.status, isFirstPilot: pilotBatches.isFirstPilot })
      .from(pilotBatches)
      .where(eq(pilotBatches.tenantId, tenantId))
      .limit(10),
    db.select({ importStatus: pilotLeadImports.importStatus })
      .from(pilotLeadImports)
      .where(and(
        eq(pilotLeadImports.tenantId, tenantId),
        ne(pilotLeadImports.importStatus, 'excluded'),
      )),
  ])

  if (!tenant) return null

  // ── Evaluate each step ──────────────────────────────────────────────────────

  // Step 1 — Production / 10DLC setup
  const dlcStatus      = tenant.tenDlcStatus
  const hasNumber      = !!tenant.smsSendingNumber
  const hasLegalName   = !!tenant.businessLegalName
  const dlcApproved    = ['approved', 'exempt', 'dev_override'].includes(dlcStatus)
  const dlcPending     = dlcStatus === 'pending'
  const productionStatus: StepStatus =
    dlcApproved && hasNumber ? 'done' :
    dlcPending               ? 'waiting' :
    hasLegalName && hasNumber ? 'pending' :
    'blocked'

  // Step 2 — Readiness / preflight
  const noComplianceBlock  = !tenant.complianceBlocked
  const hasSmsNumber       = !!tenant.smsSendingNumber
  const readinessStatus: StepStatus =
    noComplianceBlock && hasSmsNumber && dlcApproved ? 'done' :
    noComplianceBlock && hasSmsNumber                ? 'pending' :
    'blocked'

  // Step 3 — Workflow approved
  const approvedWorkflows  = workflowRows.filter(w => w.approvedForLive)
  const workflowStatus: StepStatus =
    approvedWorkflows.length > 0 ? 'done' :
    workflowRows.length > 0      ? 'pending' :
    'blocked'

  // Step 4 — Pilot leads selected
  const selectedLeads      = importRows.filter(r => r.importStatus === 'selected')
  const blockedLeads       = importRows.filter(r => r.importStatus === 'blocked')
  const leadsStatus: StepStatus =
    selectedLeads.length > 0 && blockedLeads.length === 0 ? 'done' :
    selectedLeads.length > 0                               ? 'pending' :
    importRows.length > 0                                  ? 'pending' :
    'blocked'

  // Step 5 — Pilot pack / dry-run reviewed
  const hasBatch           = batchRows.some(b => b.isFirstPilot)
  const packStatus: StepStatus =
    hasBatch && selectedLeads.length > 0 && dlcApproved ? 'done' :
    hasBatch || selectedLeads.length > 0                ? 'pending' :
    'blocked'

  // Step 6 — Ready to launch
  const batchApproved      = batchRows.some(b => b.status === 'approved' || b.status === 'sending' || b.status === 'completed')
  const launchStatus: StepStatus =
    batchApproved && dlcApproved ? 'done' :
    dlcApproved && hasBatch      ? 'pending' :
    dlcPending                   ? 'waiting' :
    'blocked'

  const steps: ChecklistStep[] = [
    {
      number: 1,
      label:  'Production & 10DLC Setup',
      detail: dlcApproved
        ? `10DLC approved · sending number: ${tenant.smsSendingNumber}`
        : dlcPending
          ? 'Carrier review in progress — no action needed'
          : !hasLegalName
            ? 'Fill in business legal name, address, and EIN'
            : !hasNumber
              ? 'Add SMS sending number'
              : 'Submit 10DLC brand + campaign registration',
      href:   '/admin/dlr/production',
      status: productionStatus,
      cta:    dlcApproved ? 'View' : 'Complete setup →',
    },
    {
      number: 2,
      label:  'Preflight Readiness',
      detail: noComplianceBlock
        ? `${hasSmsNumber ? 'Number configured' : 'No sending number yet'} · ${dlcApproved ? 'SMS live approved' : 'waiting for 10DLC'}`
        : `Compliance block active: ${tenant.complianceBlockReason ?? 'reason not set'}`,
      href:   '/admin/dlr/readiness',
      status: readinessStatus,
      cta:    readinessStatus === 'done' ? 'View' : 'Review checklist →',
    },
    {
      number: 3,
      label:  'Workflow Approved',
      detail: approvedWorkflows.length > 0
        ? `${approvedWorkflows.length} workflow${approvedWorkflows.length > 1 ? 's' : ''} approved for live sends`
        : workflowRows.length > 0
          ? `${workflowRows.length} workflow${workflowRows.length > 1 ? 's' : ''} exist — none approved yet`
          : 'No workflows created yet',
      href:   '/admin/dlr/workflows',
      status: workflowStatus,
      cta:    workflowStatus === 'done' ? 'View' : 'Review workflows →',
    },
    {
      number: 4,
      label:  'Pilot Leads Selected',
      detail: selectedLeads.length > 0
        ? `${selectedLeads.length} lead${selectedLeads.length > 1 ? 's' : ''} selected${blockedLeads.length > 0 ? ` · ${blockedLeads.length} blocked` : ' · no blockers'}`
        : importRows.length > 0
          ? `${importRows.length} lead${importRows.length > 1 ? 's' : ''} imported — select up to 5 for the pilot`
          : 'No leads imported yet',
      href:   '/admin/dlr/pilot-leads',
      status: leadsStatus,
      cta:    leadsStatus === 'done' ? 'Review' : 'Import leads →',
    },
    {
      number: 5,
      label:  'Pilot Pack Reviewed',
      detail: hasBatch
        ? 'Draft batch created — review the full pilot pack before approving'
        : selectedLeads.length > 0
          ? 'Leads selected — generate dry-run report and create batch'
          : 'Complete lead selection first',
      href:   '/admin/dlr/pilot-pack',
      status: packStatus,
      cta:    hasBatch ? 'Open Pilot Pack →' : 'Open Pilot Pack →',
    },
    {
      number: 6,
      label:  'Ready to Launch',
      detail: batchApproved && dlcApproved
        ? 'Batch approved and 10DLC confirmed — proceed to First Pilot'
        : dlcApproved && hasBatch
          ? 'Approve the batch and pass the confirmation gate to start'
          : dlcPending
            ? 'Waiting on 10DLC carrier approval — all other steps can be completed now'
            : 'Complete the steps above first',
      href:   '/admin/dlr/first-pilot',
      status: launchStatus,
      cta:    launchStatus === 'done' ? 'View Live Pilot' : 'Go to First Pilot →',
    },
  ]

  const doneCount = steps.filter(s => s.status === 'done').length

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Launch Readiness</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {doneCount} of {steps.length} steps complete
          </p>
        </div>
        {/* Progress bar */}
        <div className="w-32">
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className="h-2 rounded-full bg-emerald-500 transition-all"
              style={{ width: `${(doneCount / steps.length) * 100}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 text-right mt-1">{Math.round((doneCount / steps.length) * 100)}%</p>
        </div>
      </div>

      <div className="divide-y divide-gray-50">
        {steps.map(step => (
          <div key={step.number} className="px-5 py-3 flex items-center gap-4">
            {/* Step number */}
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
              step.status === 'done' ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-500'
            }`}>
              {step.status === 'done' ? '✓' : step.number}
            </div>

            {/* Label + detail */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800">{step.label}</p>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{step.detail}</p>
            </div>

            {/* Status badge */}
            <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[step.status]}`}>
              {STATUS_LABEL[step.status]}
            </span>

            {/* CTA link */}
            <Link
              href={step.href}
              className="shrink-0 text-xs font-semibold text-blue-600 hover:text-blue-700 whitespace-nowrap"
            >
              {step.cta}
            </Link>
          </div>
        ))}
      </div>

      {/* Footer note */}
      <div className="px-5 py-2.5 bg-gray-50 border-t border-gray-100">
        <p className="text-xs text-gray-400">
          ⏳ No live SMS will be sent until 10DLC is approved and the First Pilot confirmation gate is passed.
          All steps above are safe to complete while waiting.
        </p>
      </div>
    </div>
  )
}
