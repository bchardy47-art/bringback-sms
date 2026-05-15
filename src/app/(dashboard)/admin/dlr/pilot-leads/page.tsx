/**
 * Phase 14/15 — Pilot Lead Import + Selection + Review
 * /admin/dlr/pilot-leads
 *
 * Filter leads by status via ?status= URL param.
 * Each lead row has a review badge and "mark reviewed" control.
 * Bulk-clear blocked and dry-run report are available as action panels.
 *
 * No sends occur here. The batch is created in draft mode.
 */

import { db } from '@/lib/db'
import { pilotLeadImports, tenants, workflows } from '@/lib/db/schema'
import { eq, and, ne, inArray } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ImportForm } from './ImportForm'
import {
  AutoSelectEligible,
  BulkClearButton,
  MarkReviewedButton,
  DryRunReportPanel,
  StatusFilterSelect,
  LeadCheckbox,
  ExcludeButton,
  CreateBatchButton,
  type BucketPlanItem,
} from './LeadReviewControls'
import type { PilotPreviewMessage } from '@/lib/db/schema'
import { FIRST_PILOT_CAP, AGE_BUCKET_LABELS, type AgeBucket } from '@/lib/db/schema'

// ── Style maps ────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  eligible:     'bg-emerald-100 text-emerald-700',
  warning:      'bg-amber-100 text-amber-700',
  blocked:      'bg-red-100 text-red-700',
  selected:     'bg-blue-100 text-blue-700',
  excluded:     'bg-gray-100 text-gray-400',
  pending:      'bg-gray-100 text-gray-500',
  held:         'bg-violet-100 text-violet-700',
  needs_review: 'bg-orange-100 text-orange-700',
}

const STATUS_LABEL: Record<string, string> = {
  eligible:     '✓ Eligible',
  warning:      '⚠ Warning',
  blocked:      '✗ Blocked',
  selected:     '● Selected',
  excluded:     '— Excluded',
  pending:      '… Pending',
  held:         '⏳ Held',
  needs_review: '? Needs Review',
}

const BUCKET_COLOR: Record<AgeBucket, { bg: string; text: string; border: string }> = {
  a: { bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200' },
  b: { bg: 'bg-blue-50',     text: 'text-blue-700',    border: 'border-blue-200'    },
  c: { bg: 'bg-amber-50',    text: 'text-amber-700',   border: 'border-amber-200'   },
  d: { bg: 'bg-orange-50',   text: 'text-orange-700',  border: 'border-orange-200'  },
}

const CONSENT_STYLE: Record<string, string> = {
  explicit: 'text-emerald-700',
  implied:  'text-amber-700',
  unknown:  'text-orange-600 font-semibold',
  revoked:  'text-red-600 font-semibold',
}

const CONSENT_LABEL: Record<string, string> = {
  explicit: 'explicit',
  implied:  'implied',
  unknown:  'unknown ⛔ first-pilot blocked',
  revoked:  'revoked ⛔ hard block',
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function PilotLeadsPage({
  searchParams,
}: {
  searchParams: { status?: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect('/login')
  if (session.user.role !== 'admin') redirect('/')

  const tenantId     = session.user.tenantId
  const statusFilter = searchParams.status ?? ''

  const currentTenant = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .then(rows => rows[0])

  // Workflows for this tenant
  const tenantWorkflows = tenantId
    ? await db
        .select({ id: workflows.id, name: workflows.name })
        .from(workflows)
        .where(eq(workflows.tenantId, tenantId))
        .orderBy(workflows.name)
    : []

  // All non-excluded leads (used for stats)
  const allLeads = tenantId
    ? await db
        .select()
        .from(pilotLeadImports)
        .where(and(
          eq(pilotLeadImports.tenantId, tenantId),
          ne(pilotLeadImports.importStatus, 'excluded'),
        ))
        .orderBy(pilotLeadImports.createdAt)
    : []

  // Filtered subset for the table
  const displayLeads = statusFilter
    ? allLeads.filter(r => r.importStatus === statusFilter)
    : allLeads

  const selectedCount     = allLeads.filter(r => r.importStatus === 'selected').length
  const eligibleCount     = allLeads.filter(r => ['eligible', 'warning', 'selected'].includes(r.importStatus)).length
  const blockedCount      = allLeads.filter(r => r.importStatus === 'blocked').length
  const heldCount         = allLeads.filter(r => r.importStatus === 'held').length
  // "Needs Date" — rows the operator still owes a contact date for. importLeads
  // never assigns importStatus='needs_review'; it promotes missing-date rows to
  // 'warning' instead. Count by contactDate IS NULL excluding permanently-rejected
  // rows (blocked / excluded), which match what the operator can act on.
  const needsReviewCount  = allLeads.filter(r =>
    r.contactDate == null &&
    r.importStatus !== 'blocked' &&
    r.importStatus !== 'excluded'
  ).length
  const reviewedCount     = allLeads.filter(r => r.reviewed).length

  const bucketCounts: Record<AgeBucket, number> = {
    a: allLeads.filter(r => r.ageBucket === 'a').length,
    b: allLeads.filter(r => r.ageBucket === 'b').length,
    c: allLeads.filter(r => r.ageBucket === 'c').length,
    d: allLeads.filter(r => r.ageBucket === 'd').length,
  }

  // Build the bucket plan for the CreateBatchButton (selected leads grouped by workflow)
  const selectedLeads = allLeads.filter(r => r.importStatus === 'selected')
  const selectedImportIds = selectedLeads.map(r => r.id)

  const assignedWorkflowIds = Array.from(
    new Set(selectedLeads.map(r => r.assignedWorkflowId).filter(Boolean) as string[]),
  )
  const bucketWorkflowDetails = assignedWorkflowIds.length > 0
    ? await db
        .select({ id: workflows.id, name: workflows.name, ageBucket: workflows.ageBucket })
        .from(workflows)
        .where(inArray(workflows.id, assignedWorkflowIds))
    : []
  const wfById = new Map(bucketWorkflowDetails.map(w => [w.id, w]))

  // Group selected leads by assignedWorkflowId → one BucketPlanItem per group
  const bucketPlanMap = new Map<string, BucketPlanItem>()
  for (const lead of selectedLeads) {
    if (!lead.assignedWorkflowId) continue
    const wf = wfById.get(lead.assignedWorkflowId)
    if (!wf) continue
    const key = lead.assignedWorkflowId
    if (!bucketPlanMap.has(key)) {
      bucketPlanMap.set(key, {
        workflowId:   wf.id,
        workflowName: wf.name,
        ageBucket:    wf.ageBucket,
        bucketLabel:  wf.ageBucket ? AGE_BUCKET_LABELS[wf.ageBucket as AgeBucket] : 'Unknown',
        leadCount:    0,
      })
    }
    bucketPlanMap.get(key)!.leadCount++
  }
  const bucketPlan = Array.from(bucketPlanMap.values())
    .sort((a, b) => (a.ageBucket ?? 'z').localeCompare(b.ageBucket ?? 'z'))

  // Count selected leads without an assigned workflow (need manual handling)
  const unassignedSelectedCount = selectedLeads.filter(r => !r.assignedWorkflowId).length

  // ── Plain-English summary ───────────────────────────────────────────────────
  // Built from existing counts — no extra queries needed.
  const activeBucketCount = Object.values(bucketCounts).filter(c => c > 0).length
  const readyCount        = selectedCount > 0 ? selectedCount : eligibleCount

  let summaryText = ''
  if (allLeads.length > 0) {
    if (readyCount > 0) {
      summaryText +=
        `${readyCount} lead${readyCount !== 1 ? 's' : ''} ` +
        (selectedCount > 0 ? 'selected' : 'ready') +
        (activeBucketCount > 0
          ? ` across ${activeBucketCount} age window${activeBucketCount !== 1 ? 's' : ''}.`
          : '.')
    }
    if (heldCount > 0) {
      const heldLeads  = allLeads.filter(r => r.importStatus === 'held')
      const firstReady = heldLeads
        .map(r => r.enrollAfter)
        .filter(Boolean)
        .sort()[0]
      const dateStr = firstReady ? new Date(firstReady).toLocaleDateString() : 'soon'
      summaryText +=
        heldCount === 1
          ? ` ${heldLeads[0]?.firstName ?? '1 lead'} was contacted recently — auto-held until ${dateStr}.`
          : ` ${heldCount} leads auto-held until they hit the 14-day mark (first ready ${dateStr}).`
    }
    if (blockedCount > 0) {
      summaryText += ` ${blockedCount} lead${blockedCount !== 1 ? 's' : ''} can't be included (permanently blocked).`
    }
  }

  // ── Split display leads: actionable rows first, blocked rows last ──────────
  const actionableLeads = displayLeads.filter(r => r.importStatus !== 'blocked')
  const blockedLeads    = displayLeads.filter(r => r.importStatus === 'blocked')

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">

      {/* ── Dealer context banner ─────────────────────────────────────────── */}
      <div className="rounded-xl bg-gray-900 px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-0.5">
            Pilot Lead Setup
          </p>
          <p className="text-xl font-bold text-white">
            {currentTenant?.name ?? 'Select a dealer'}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="/admin/dlr/intakes"
            className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            ← Intake checklist
          </a>
        </div>
      </div>

      {tenantId && (
        <>
          {/* ── Auto-select: fires once when eligible leads exist but none selected ── */}
          {eligibleCount > 0 && selectedCount === 0 && (
            <AutoSelectEligible tenantId={tenantId} />
          )}

          {/* ── Summary + Top CTA (only when leads exist) ─────────────────── */}
          {allLeads.length > 0 && (
            <div className="space-y-3">

              {/* Narrative summary — plain English, one glance */}
              {summaryText && (
                <p className="text-sm text-gray-700 leading-relaxed">
                  {summaryText}
                </p>
              )}

              {/* Top CTA — shown as soon as leads are selected */}
              {selectedCount > 0 && bucketPlan.length > 0 && (
                <div className="rounded-xl border-2 border-blue-300 bg-blue-50 px-5 py-4 flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-blue-900">
                      Ready to launch — {selectedCount} lead{selectedCount !== 1 ? 's' : ''} across {bucketPlan.length} age bucket{bucketPlan.length !== 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-blue-700">
                      No messages sent yet — batches are draft only until you approve them.
                    </p>
                    {/* Compact bucket list */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {bucketPlan.map(b => (
                        <span
                          key={b.workflowId}
                          className="px-2 py-0.5 bg-white border border-blue-200 rounded-full text-xs text-blue-800 font-medium"
                        >
                          {b.bucketLabel}: {b.leadCount}
                        </span>
                      ))}
                    </div>
                  </div>
                  <CreateBatchButton
                    tenantId={tenantId}
                    importIds={selectedImportIds}
                    bucketPlan={bucketPlan}
                    compact
                  />
                </div>
              )}

              {/* Stat cards row */}
              <div className="grid grid-cols-6 gap-2">
                {[
                  { label: 'Imported',     value: allLeads.length, color: 'text-gray-900' },
                  { label: 'Ready',        value: eligibleCount,   color: 'text-emerald-600' },
                  { label: 'Held',         value: heldCount,       color: heldCount > 0 ? 'text-violet-600' : 'text-gray-300' },
                  { label: 'Needs Date',   value: needsReviewCount, color: needsReviewCount > 0 ? 'text-orange-600' : 'text-gray-300' },
                  { label: 'Blocked',      value: blockedCount,    color: blockedCount > 0 ? 'text-red-600' : 'text-gray-300' },
                  {
                    label: `Selected / ${FIRST_PILOT_CAP}`,
                    value: `${selectedCount} / ${FIRST_PILOT_CAP}`,
                    color: selectedCount >= FIRST_PILOT_CAP ? 'text-blue-700' : selectedCount > 0 ? 'text-blue-600' : 'text-gray-300',
                  },
                ].map(s => (
                  <div key={s.label} className="bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-center shadow-sm">
                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Bucket breakdown */}
              {(bucketCounts.a + bucketCounts.b + bucketCounts.c + bucketCounts.d) > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {(['a', 'b', 'c', 'd'] as AgeBucket[]).map(bucket => {
                    const count  = bucketCounts[bucket]
                    const colors = BUCKET_COLOR[bucket]
                    return (
                      <div
                        key={bucket}
                        className={`border rounded-lg px-3 py-2.5 text-center ${colors.bg} ${colors.border}`}
                      >
                        <p className={`text-lg font-bold ${colors.text}`}>{count}</p>
                        <p className={`text-xs font-medium ${colors.text} opacity-80`}>
                          {AGE_BUCKET_LABELS[bucket]}
                        </p>
                        <p className={`text-xs ${colors.text} opacity-60`}>Bucket {bucket.toUpperCase()}</p>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Held leads callout */}
              {heldCount > 0 && (
                <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 text-xs text-violet-800">
                  <span className="font-semibold">⏳ {heldCount} held lead{heldCount !== 1 ? 's' : ''}:</span>{' '}
                  contacted less than 14 days ago — will become eligible for outreach once they reach the 14-day mark.
                </div>
              )}
            </div>
          )}

          {/* ── Step 1: Import ─────────────────────────────────────────────── */}
          <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex items-center gap-3">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-800 text-white text-xs font-bold shrink-0">
                1
              </span>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Upload leads</h2>
                <p className="text-xs text-gray-500">
                  Import a CSV of dead leads for this dealer. Each row is validated immediately.
                </p>
              </div>
            </div>
            <div className="p-5">
              <ImportForm tenantId={tenantId} />
            </div>
          </div>

          {/* ── Zero-state when no leads yet ───────────────────────────────── */}
          {allLeads.length === 0 && (
            <div className="rounded-xl border-2 border-dashed border-gray-200 py-14 px-8 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-4">
                <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-gray-700 mb-1">No leads imported yet</h3>
              <p className="text-sm text-gray-500 max-w-sm mx-auto">
                Upload a CSV from {currentTenant?.name}&apos;s CRM above. You need at least 1 eligible lead to create a pilot batch.
              </p>
              <div className="mt-5 inline-block bg-blue-50 border border-blue-100 rounded-lg px-4 py-2 text-xs text-blue-700">
                Tip: Start with 5–10 leads so you have room to exclude any that are blocked.
              </div>
            </div>
          )}

          {/* ── Step 2: Review & select ────────────────────────────────────── */}
          {allLeads.length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex flex-wrap items-center gap-3 justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-800 text-white text-xs font-bold shrink-0">
                    2
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">
                      Review &amp; select
                      <span className="ml-1.5 font-normal text-gray-400">
                        ({displayLeads.length}{statusFilter ? ` of ${allLeads.length}` : ''} leads)
                      </span>
                    </h2>
                    <p className="text-xs text-gray-500">
                      Check each lead, then select up to {FIRST_PILOT_CAP} for the pilot batch.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusFilterSelect tenantId={tenantId} statusFilter={statusFilter} />
                  <BulkClearButton tenantId={tenantId} blockedCount={blockedCount} />
                  {selectedCount > 0 && (
                    <span className="px-2.5 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">
                      {selectedCount} / {FIRST_PILOT_CAP} selected
                    </span>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-gray-500 uppercase tracking-wide text-left">
                      <th className="px-4 py-2.5 w-8">✓</th>
                      <th className="px-4 py-2.5">Name</th>
                      <th className="px-4 py-2.5">Phone</th>
                      <th className="px-4 py-2.5">Consent</th>
                      <th className="px-4 py-2.5">Vehicle</th>
                      <th className="px-4 py-2.5">Age</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5">Issues / Warnings</th>
                      <th className="px-4 py-2.5">Preview</th>
                      <th className="px-4 py-2.5">Review</th>
                      <th className="px-4 py-2.5 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">

                    {/* ── Actionable leads (eligible / warning / held / selected) ── */}
                    {actionableLeads.map(lead => {
                      const isSelected       = lead.importStatus === 'selected'
                      const consentVal       = (lead.consentStatus ?? 'unknown').toLowerCase().trim()
                      const isUnknownConsent = consentVal === 'unknown' || consentVal === ''
                      const canSelect        = !isUnknownConsent && (isSelected || selectedCount < FIRST_PILOT_CAP)
                      const previews         = (lead.previewMessages as PilotPreviewMessage[] | null) ?? []

                      return (
                        <tr
                          key={lead.id}
                          className={`transition-colors ${
                            isSelected    ? 'bg-blue-50' :
                            lead.reviewed ? 'bg-emerald-50/40' :
                            'hover:bg-gray-50'
                          }`}
                        >
                          <td className="px-4 py-3">
                            <LeadCheckbox
                              leadId={lead.id}
                              tenantId={tenantId}
                              isSelected={isSelected}
                              canSelect={canSelect}
                            />
                          </td>

                          <td className="px-4 py-3">
                            <p className="font-semibold text-gray-800">
                              {lead.firstName} {lead.lastName}
                            </p>
                            {lead.email && <p className="text-gray-400">{lead.email}</p>}
                            {lead.leadSource && <p className="text-gray-400 italic">{lead.leadSource}</p>}
                            {(lead.duplicateOfLeadId || lead.duplicateOfImportId) && (
                              <p className="text-orange-500 font-semibold">🔁 duplicate</p>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <p className="font-mono text-gray-700">{lead.phone ?? '—'}</p>
                            {lead.phone !== lead.phoneRaw && (
                              <p className="text-gray-400">raw: {lead.phoneRaw}</p>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <p className={`font-medium ${CONSENT_STYLE[lead.consentStatus] ?? 'text-orange-600 font-semibold'}`}>
                              {CONSENT_LABEL[lead.consentStatus] ?? `${lead.consentStatus ?? 'unknown'} ⛔ first-pilot blocked`}
                            </p>
                            {lead.consentSource && <p className="text-gray-400">{lead.consentSource}</p>}
                            {lead.smsConsentNotes && <p className="text-gray-400 italic">{lead.smsConsentNotes}</p>}
                          </td>

                          <td className="px-4 py-3 text-gray-600">
                            {lead.vehicleOfInterest
                              ? lead.vehicleOfInterest
                              : <span className="text-gray-300 italic">none — fallback ⚠</span>
                            }
                          </td>

                          <td className="px-4 py-3">
                            {lead.ageBucket ? (
                              <div className="space-y-0.5">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${BUCKET_COLOR[lead.ageBucket as AgeBucket]?.bg ?? ''} ${BUCKET_COLOR[lead.ageBucket as AgeBucket]?.text ?? ''}`}>
                                  {AGE_BUCKET_LABELS[lead.ageBucket as AgeBucket]}
                                </span>
                                {lead.leadAgeDays != null && (
                                  <p className="text-gray-400 text-xs">{lead.leadAgeDays}d old</p>
                                )}
                              </div>
                            ) : lead.importStatus === 'held' ? (
                              <div className="space-y-0.5">
                                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-700">
                                  &lt; 14d
                                </span>
                                {lead.leadAgeDays != null && (
                                  <p className="text-gray-400 text-xs">{lead.leadAgeDays}d old</p>
                                )}
                                {lead.enrollAfter && (
                                  <p className="text-violet-500 text-xs">
                                    Ready {new Date(lead.enrollAfter).toLocaleDateString()}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-300 italic text-xs">no date</span>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[lead.importStatus] ?? ''}`}>
                              {STATUS_LABEL[lead.importStatus] ?? lead.importStatus}
                            </span>
                          </td>

                          <td className="px-4 py-3 max-w-xs">
                            {(lead.warnings as string[] | null)?.map((w, i) => (
                              <p key={i} className="text-amber-600 leading-snug">⚠ {w}</p>
                            ))}
                            {!(lead.warnings as string[] | null)?.length && (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            {previews.length > 0 ? (
                              <div className="space-y-1">
                                {previews.map((p, i) => (
                                  <div key={i} className="text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-1 text-xs leading-snug">
                                    <p className="text-gray-400 mb-0.5">
                                      Step {p.position}{p.usedFallback ? ' ⚠ fallback' : ''}
                                    </p>
                                    {p.rendered?.slice(0, 120)}{(p.rendered?.length ?? 0) > 120 ? '…' : ''}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-gray-300 text-xs italic">none yet</span>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <MarkReviewedButton
                              importId={lead.id}
                              tenantId={tenantId}
                              alreadyReviewed={lead.reviewed}
                            />
                            {lead.reviewedBy && (
                              <p className="text-gray-400 text-xs mt-0.5">{lead.reviewedBy}</p>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <ExcludeButton leadId={lead.id} tenantId={tenantId} />
                          </td>
                        </tr>
                      )
                    })}

                    {/* ── Blocked leads divider + rows ─────────────────────────── */}
                    {blockedLeads.length > 0 && (
                      <>
                        <tr>
                          <td colSpan={11} className="px-4 py-2 bg-red-50 border-t border-red-200">
                            <p className="text-xs font-semibold text-red-600">
                              ✗ {blockedLeads.length} permanently blocked lead{blockedLeads.length !== 1 ? 's' : ''} — cannot be included in the pilot
                            </p>
                          </td>
                        </tr>
                        {blockedLeads.map(lead => {
                          const previews = (lead.previewMessages as PilotPreviewMessage[] | null) ?? []
                          return (
                            <tr key={lead.id} className="bg-red-50/60 opacity-70">
                              <td className="px-4 py-2.5" />

                              <td className="px-4 py-2.5">
                                <p className="font-semibold text-gray-700 line-through decoration-red-300">
                                  {lead.firstName} {lead.lastName}
                                </p>
                                {lead.leadSource && <p className="text-gray-400 italic text-xs">{lead.leadSource}</p>}
                              </td>

                              <td className="px-4 py-2.5 font-mono text-gray-500 text-xs">
                                {lead.phone ?? '—'}
                              </td>

                              <td className="px-4 py-2.5">
                                <p className={`font-medium text-xs ${CONSENT_STYLE[lead.consentStatus] ?? 'text-orange-600 font-semibold'}`}>
                                  {CONSENT_LABEL[lead.consentStatus] ?? (lead.consentStatus ?? 'unknown')}
                                </p>
                              </td>

                              <td className="px-4 py-2.5 text-gray-400 text-xs">
                                {lead.vehicleOfInterest ?? '—'}
                              </td>

                              <td className="px-4 py-2.5">
                                <span className="text-gray-300 italic text-xs">—</span>
                              </td>

                              <td className="px-4 py-2.5">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE.blocked}`}>
                                  {STATUS_LABEL.blocked}
                                </span>
                              </td>

                              <td className="px-4 py-2.5 max-w-xs">
                                {(lead.blockedReasons as string[] | null)?.map((r, i) => (
                                  <p key={i} className="text-red-600 text-xs leading-snug">✗ {r}</p>
                                ))}
                              </td>

                              <td className="px-4 py-2.5" colSpan={2}>
                                <span className="text-gray-300 text-xs italic">—</span>
                              </td>

                              <td className="px-4 py-2.5">
                                <ExcludeButton leadId={lead.id} tenantId={tenantId} />
                              </td>
                            </tr>
                          )
                        })}
                      </>
                    )}

                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Dry-run report */}
          {allLeads.length > 0 && (
            <DryRunReportPanel tenantId={tenantId} />
          )}

          {/* ── Step 3: Create pilot batch ─────────────────────────────────── */}
          {allLeads.length > 0 && (
            <div className={`border-2 rounded-xl overflow-hidden shadow-sm ${
              selectedCount > 0 ? 'border-blue-300' : 'border-gray-200'
            }`}>
              <div className={`px-5 py-3 border-b flex items-center gap-3 ${
                selectedCount > 0 ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'
              }`}>
                <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0 ${
                  selectedCount > 0 ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-600'
                }`}>
                  3
                </span>
                <div>
                  <h2 className={`text-sm font-semibold ${selectedCount > 0 ? 'text-blue-900' : 'text-gray-500'}`}>
                    {selectedCount > 0
                      ? `Create Recommended Pilot — ${selectedCount} lead${selectedCount !== 1 ? 's' : ''} selected`
                      : 'Create Recommended Pilot — select leads above first'
                    }
                  </h2>
                  <p className={`text-xs mt-0.5 ${selectedCount > 0 ? 'text-blue-700' : 'text-gray-400'}`}>
                    Creates a <strong>draft batch only</strong>. No messages sent until you approve each batch.
                  </p>
                </div>
              </div>

              {selectedCount > 0 ? (
                <div className="p-5">
                  {bucketPlan.length > 0 ? (
                    <CreateBatchButton
                      tenantId={tenantId}
                      importIds={selectedImportIds}
                      bucketPlan={bucketPlan}
                    />
                  ) : (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 space-y-1">
                      <p className="font-semibold">⚠ Selected leads have no age-bucket workflow assigned</p>
                      <p>
                        Clear these leads, re-import with a contact date column, and ensure the
                        4 age-bucket workflows are configured for this tenant.
                      </p>
                      {unassignedSelectedCount > 0 && (
                        <p className="text-gray-500">
                          {unassignedSelectedCount} lead{unassignedSelectedCount === 1 ? '' : 's'} without an assigned workflow.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="px-5 py-6 text-center">
                  <p className="text-sm text-gray-400">
                    Select eligible leads in Step 2 to unlock this section.
                    DLR will auto-assign each lead to its age-bucket workflow — no manual selection needed.
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
