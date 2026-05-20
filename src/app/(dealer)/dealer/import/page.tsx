/**
 * /dealer/import
 *
 * Dealer-facing lead import page. Identical to the admin pilot-leads page
 * except:
 *  - tenantId is locked to session.user.tenantId (no tenant switcher)
 *  - Back-links go to dealer routes
 *  - "Created By" labelled as dealer's name, not operator
 */

import { db } from '@/lib/db'
import { pilotLeadImports, workflows, leads } from '@/lib/db/schema'
import { eq, and, ne, inArray } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ImportForm } from '@/app/(dashboard)/admin/dlr/pilot-leads/ImportForm'
import { DealerConsentGate } from './DealerConsentGate'
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
} from '@/app/(dashboard)/admin/dlr/pilot-leads/LeadReviewControls'
import type { PilotPreviewMessage } from '@/lib/db/schema'
import { FIRST_PILOT_CAP, type AgeBucket } from '@/lib/db/schema'
import { DEALER_BUCKET_LABEL } from '@/lib/pilot/age-classification'

// ── Style maps (duplicated from admin page for independence) ──────────────────

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
  needs_review: '? Needs Date',
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
  unknown:  'unknown ⛔ not eligible yet',
  revoked:  'revoked ⛔ hard block',
}

// Re-render stored warning strings in dealer-friendly wording. Historical
// pilot_lead_imports rows include engineering-speak warnings from earlier
// versions of the import pipeline ("imported before age classification was
// wired"). We can't backfill those rows during demo prep, so we map known
// phrasings to plain-English equivalents at render time.
function friendlyWarning(raw: string): string {
  if (raw.startsWith('Contact date missing — imported before age classification was wired')) {
    return 'Missing contact date — re-upload this lead with a contact date to include it.'
  }
  return raw
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DealerImportPage({
  searchParams,
}: {
  searchParams: { status?: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'dealer') redirect('/dashboard')

  const tenantId     = session.user.tenantId
  const statusFilter = searchParams.status ?? ''

  // Workflows for this tenant
  const tenantWorkflows = await db
    .select({ id: workflows.id, name: workflows.name })
    .from(workflows)
    .where(eq(workflows.tenantId, tenantId))
    .orderBy(workflows.name)

  // Dealer-only filter: rows with import_status IN ('warning','held') are
  // admin-actionable probe/triage rows the dealer can't act on, and rows
  // linked to leads flagged is_test=true are demo fixtures that should be
  // hidden once flagged. Admin views are unchanged — this filter lives
  // only in the dealer route.
  const testLeadIds = new Set(
    (await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.tenantId, tenantId), eq(leads.isTest, true)))
    ).map(r => r.id),
  )

  const allLeadsRaw = await db
    .select()
    .from(pilotLeadImports)
    .where(and(
      eq(pilotLeadImports.tenantId, tenantId),
      ne(pilotLeadImports.importStatus, 'excluded'),
    ))
    .orderBy(pilotLeadImports.createdAt)

  const allLeads = allLeadsRaw.filter(r =>
    r.importStatus !== 'warning' &&
    r.importStatus !== 'held' &&
    !(r.leadId && testLeadIds.has(r.leadId)),
  )

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

  const bucketCounts: Record<AgeBucket, number> = {
    a: allLeads.filter(r => r.ageBucket === 'a').length,
    b: allLeads.filter(r => r.ageBucket === 'b').length,
    c: allLeads.filter(r => r.ageBucket === 'c').length,
    d: allLeads.filter(r => r.ageBucket === 'd').length,
  }

  const selectedLeads    = allLeads.filter(r => r.importStatus === 'selected')
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

  const bucketPlanMap = new Map<string, BucketPlanItem>()
  for (const lead of selectedLeads) {
    if (!lead.assignedWorkflowId) continue
    const wf = wfById.get(lead.assignedWorkflowId)
    if (!wf) continue
    if (!bucketPlanMap.has(lead.assignedWorkflowId)) {
      bucketPlanMap.set(lead.assignedWorkflowId, {
        workflowId:   wf.id,
        workflowName: wf.name,
        ageBucket:    wf.ageBucket,
        bucketLabel:  wf.ageBucket ? DEALER_BUCKET_LABEL[wf.ageBucket as AgeBucket] : 'Unknown',
        leadCount:    0,
      })
    }
    bucketPlanMap.get(lead.assignedWorkflowId)!.leadCount++
  }
  const bucketPlan = Array.from(bucketPlanMap.values())
    .sort((a, b) => (a.ageBucket ?? 'z').localeCompare(b.ageBucket ?? 'z'))

  const unassignedSelectedCount = selectedLeads.filter(r => !r.assignedWorkflowId).length
  const actionableLeads = displayLeads.filter(r => r.importStatus !== 'blocked')
  const blockedLeads    = displayLeads.filter(r => r.importStatus === 'blocked')

  // All ImportForm + LeadReviewControls components on this page route through
  // the dealer-only API surface (requireDealer + session tenantId). The admin
  // /api/admin/dlr/pilot-leads routes stay locked to requireAdmin.
  const apiBase = '/api/dealer/pilot-leads'

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Upload Leads</h1>
        <p className="mt-1 text-sm text-gray-500">
          Upload a CSV of prior dealership leads. The file is validated,
          grouped by age, and prepared for campaign review before any
          messages are sent.
        </p>
      </div>

      {/* Lead age detection helper — keeps the upload flow honest about which
          date column DLR needs and why some leads get held or flagged. */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 md:p-5 space-y-3 text-sm text-gray-700">
        <div>
          <p className="text-sm font-semibold text-gray-900">Lead age detection</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Nothing is sent from this page — uploading only prepares previews.
          </p>
        </div>

        <p>
          Include the date each lead originally contacted your store. DLR uses
          that date to group leads into safe follow-up campaigns.
        </p>

        <p className="text-xs text-gray-600">
          Common column names we recognize (case-insensitive):
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-xs">
          <div>
            <p className="font-semibold text-gray-800">Preferred — original inquiry date</p>
            <p className="text-gray-600 leading-snug">
              <code className="text-gray-700">Lead Date</code>, <code className="text-gray-700">Created Date</code>,{' '}
              <code className="text-gray-700">Date Created</code>, <code className="text-gray-700">Inquiry Date</code>,{' '}
              <code className="text-gray-700">Submitted Date</code>, <code className="text-gray-700">Received Date</code>,{' '}
              <code className="text-gray-700">Prospect Date</code>, <code className="text-gray-700">Created</code>
            </p>
          </div>
          <div>
            <p className="font-semibold text-gray-800">Fallback — only if no original date</p>
            <p className="text-gray-600 leading-snug">
              <code className="text-gray-700">Last Activity Date</code>, <code className="text-gray-700">Last Contacted</code>,{' '}
              <code className="text-gray-700">Last Contacted Date</code>, bare <code className="text-gray-700">Date</code>
            </p>
          </div>
        </div>

        <p className="text-xs text-gray-600 leading-relaxed">
          <span className="font-semibold text-gray-800">Why priority matters:</span>{' '}
          the original inquiry date tells DLR how cold the lead actually is. A
          “last activity” date is only used when no original column is present
          — it can make a long-cold lead look recent.
        </p>

        <ul className="text-xs text-gray-600 space-y-1.5">
          <li>
            <span className="font-semibold text-violet-700">Held:</span>{' '}
            contacted less than 14 days ago — too fresh for campaign messaging.
          </li>
          <li>
            <span className="font-semibold text-orange-700">Needs Date:</span>{' '}
            DLR cannot safely choose a campaign group without a lead date. Re-upload with one of the columns above.
          </li>
          <li>
            <span className="font-semibold text-red-600">Blocked:</span>{' '}
            phone is invalid, opted out, or revoked consent — DLR will not include the row.
          </li>
        </ul>
      </div>

      {/* Auto-select trigger */}
      {eligibleCount > 0 && selectedCount === 0 && (
        <AutoSelectEligible tenantId={tenantId} apiBase={apiBase} />
      )}

      {/* Summary */}
      {allLeads.length > 0 && (
        <div className="space-y-3">
          {/* Top CTA */}
          {selectedCount > 0 && bucketPlan.length > 0 && (
            <div className="rounded-xl border-2 border-blue-300 bg-blue-50 px-5 py-4 flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-blue-900">
                  Ready — {selectedCount} lead{selectedCount !== 1 ? 's' : ''} across {bucketPlan.length} age window{bucketPlan.length !== 1 ? 's' : ''}
                </p>
                <p className="text-xs text-blue-700">
                  No messages sent yet — you&apos;ll review and approve each campaign separately.
                </p>
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
                apiBase={apiBase}
                bucketSectionTitle="Auto-assigned campaign groups"
              />
            </div>
          )}

          {/* Stat cards. Mobile-first: 2 columns at base, 3 at sm,
              6 at lg. Previously this was fixed grid-cols-6 which squeezed
              each card to ~50px on iPhone. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {[
              { label: 'Imported',   value: allLeads.length, color: 'text-gray-900' },
              { label: 'Ready',      value: eligibleCount,   color: 'text-emerald-600' },
              { label: 'Held',       value: heldCount,       color: heldCount > 0 ? 'text-violet-600' : 'text-gray-300' },
              { label: 'Needs Date', value: needsReviewCount, color: needsReviewCount > 0 ? 'text-orange-600' : 'text-gray-300' },
              { label: 'Blocked',    value: blockedCount,    color: blockedCount > 0 ? 'text-red-600' : 'text-gray-300' },
              {
                // Big number = count selected. Label depends on whether
                // the selection spans one or more age-bucket groups —
                // previously this read "Selected (max 5)" which dealers
                // misread as "you cannot select more than 5 in total."
                // The first-pilot cap is per group, not global; rephrasing
                // "across groups" / "for this group" makes that explicit.
                // Detailed helper copy appears in the Step 2 subtitle.
                label:
                  bucketPlan.length > 1   ? 'Selected across groups'   :
                  bucketPlan.length === 1 ? 'Selected for this group'  :
                                            'Selected',
                value: selectedCount,
                color: selectedCount > 0 ? 'text-blue-600' : 'text-gray-300',
              },
            ].map(s => (
              <div key={s.label} className="bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-center shadow-sm">
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Held callout */}
          {heldCount > 0 && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 text-xs text-violet-800">
              <span className="font-semibold">⏳ {heldCount} held lead{heldCount !== 1 ? 's' : ''}:</span>{' '}
              held because {heldCount === 1 ? 'this lead is' : 'these leads are'} too fresh for campaign messaging.
              {heldCount === 1 ? ' It' : ' They'}&apos;ll become eligible at the 14-day mark.
            </div>
          )}
        </div>
      )}

      {/* Step 1: Upload */}
      <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex items-center gap-3">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-800 text-white text-xs font-bold shrink-0">1</span>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Upload your CSV</h2>
            <p className="text-xs text-gray-500">Each row is validated immediately. Nothing is sent until you and DLR admin approve a campaign.</p>
          </div>
        </div>
        <div className="p-5">
          <DealerConsentGate>
            <ImportForm tenantId={tenantId} apiBase={apiBase} />
          </DealerConsentGate>
        </div>
      </div>

      {/* Zero state */}
      {allLeads.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-10 px-6 text-center space-y-2">
          <h3 className="text-base font-semibold text-gray-700">No leads yet</h3>
          <p className="text-sm text-gray-600 max-w-md mx-auto">
            Upload a CSV above. After upload, each row is validated and grouped by age,
            and prepares preview campaigns for your review.
          </p>
          <p className="text-xs text-gray-400 max-w-md mx-auto">
            Nothing is sent until you approve a campaign. Tip: start with 5–10 leads so you
            have room to exclude any blocked ones.
          </p>
        </div>
      )}

      {/* Step 2: Review & select */}
      {allLeads.length > 0 && (
        <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex flex-wrap items-center gap-3 justify-between">
            <div className="flex items-center gap-3">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-800 text-white text-xs font-bold shrink-0">2</span>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  Review &amp; select
                  <span className="ml-1.5 font-normal text-gray-400">
                    ({displayLeads.length}{statusFilter ? ` of ${allLeads.length}` : ''} leads)
                  </span>
                </h2>
                <p className="text-xs text-gray-500">
                  Check each lead, then add it to your first campaign selection.
                  DLR caps each first campaign group at {FIRST_PILOT_CAP} leads so
                  you can review safely. No messages send from this page.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StatusFilterSelect tenantId={tenantId} statusFilter={statusFilter} />
              <BulkClearButton tenantId={tenantId} blockedCount={blockedCount} apiBase={apiBase} />
              {selectedCount > 0 && (
                <span className="px-2.5 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">
                  {selectedCount} selected
                  {bucketPlan.length > 1 ? ` across ${bucketPlan.length} groups` : ''}
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
                  <th className="px-4 py-2.5">Issues</th>
                  <th className="px-4 py-2.5">Preview</th>
                  <th className="px-4 py-2.5">Review</th>
                  <th className="px-4 py-2.5 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">

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
                          apiBase={apiBase}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-800">{lead.firstName} {lead.lastName}</p>
                        {lead.email && <p className="text-gray-400">{lead.email}</p>}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-700">{lead.phone ?? '—'}</td>
                      <td className="px-4 py-3">
                        <p className={`font-medium ${CONSENT_STYLE[lead.consentStatus] ?? 'text-orange-600 font-semibold'}`}>
                          {CONSENT_LABEL[lead.consentStatus] ?? `${lead.consentStatus ?? 'unknown'} ⛔`}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {lead.vehicleOfInterest ?? <span className="text-gray-300 italic">none ⚠</span>}
                      </td>
                      <td className="px-4 py-3">
                        {lead.ageBucket ? (
                          <div className="space-y-0.5">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${BUCKET_COLOR[lead.ageBucket as AgeBucket]?.bg ?? ''} ${BUCKET_COLOR[lead.ageBucket as AgeBucket]?.text ?? ''}`}>
                              {DEALER_BUCKET_LABEL[lead.ageBucket as AgeBucket]}
                            </span>
                            {lead.leadAgeDays != null && (
                              <p className="text-gray-400 text-xs">{lead.leadAgeDays}d old</p>
                            )}
                          </div>
                        ) : lead.importStatus === 'held' ? (
                          <div className="space-y-0.5">
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-700">&lt; 14d</span>
                            {lead.leadAgeDays != null && (
                              <p className="text-gray-400 text-xs">{lead.leadAgeDays}d old</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-300 italic text-xs">missing date</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[lead.importStatus] ?? ''}`}>
                          {STATUS_LABEL[lead.importStatus] ?? lead.importStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        {(lead.warnings as string[] | null)?.map((w, i) => (
                          <p key={i} className="text-amber-600 leading-snug">⚠ {friendlyWarning(w)}</p>
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
                                <p className="text-gray-400 mb-0.5">Step {p.position}{p.usedFallback ? ' ⚠ fallback' : ''}</p>
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
                          apiBase={apiBase}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <ExcludeButton leadId={lead.id} tenantId={tenantId} apiBase={apiBase} />
                      </td>
                    </tr>
                  )
                })}

                {blockedLeads.length > 0 && (
                  <>
                    <tr>
                      <td colSpan={11} className="px-4 py-2 bg-red-50 border-t border-red-200">
                        <p className="text-xs font-semibold text-red-600">
                          ✗ {blockedLeads.length} blocked lead{blockedLeads.length !== 1 ? 's' : ''} — cannot be included
                        </p>
                      </td>
                    </tr>
                    {blockedLeads.map(lead => (
                      <tr key={lead.id} className="bg-red-50/60 opacity-70">
                        <td className="px-4 py-2.5" />
                        <td className="px-4 py-2.5">
                          <p className="font-semibold text-gray-700 line-through decoration-red-300">
                            {lead.firstName} {lead.lastName}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-gray-500 text-xs">{lead.phone ?? '—'}</td>
                        <td className="px-4 py-2.5">
                          <p className={`font-medium text-xs ${CONSENT_STYLE[lead.consentStatus] ?? 'text-orange-600 font-semibold'}`}>
                            {CONSENT_LABEL[lead.consentStatus] ?? (lead.consentStatus ?? 'unknown')}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-gray-400 text-xs" colSpan={2}>{lead.vehicleOfInterest ?? '—'}</td>
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
                        <td className="px-4 py-3">
                          <ExcludeButton leadId={lead.id} tenantId={tenantId} apiBase={apiBase} />
                        </td>
                      </tr>
                    ))}
                  </>
                )}

              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Dry-run */}
      {allLeads.length > 0 && <DryRunReportPanel tenantId={tenantId} apiBase={apiBase} title="Preview Report" />}

      {/* Step 3: Create batch */}
      {allLeads.length > 0 && (
        <div className={`border-2 rounded-xl overflow-hidden shadow-sm ${selectedCount > 0 ? 'border-blue-300' : 'border-gray-200'}`}>
          <div className={`px-5 py-3 border-b flex items-center gap-3 ${selectedCount > 0 ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
            <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0 ${selectedCount > 0 ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-600'}`}>3</span>
            <div>
              {/*
                Heading pluralizes with bucketPlan: 1 group → "Create Pilot
                Batch", 2+ groups → "Create Pilot Batches" — same logic the
                Create button below uses, so the section header and CTA can't
                drift. Selected count gets the "across N groups" suffix when
                more than one group is in play.
              */}
              <h2 className={`text-sm font-semibold ${selectedCount > 0 ? 'text-blue-900' : 'text-gray-500'}`}>
                {(() => {
                  const noun = bucketPlan.length > 1 ? 'Create Campaigns' : 'Create Campaign'
                  if (selectedCount === 0) return `${noun} — select leads above first`
                  const groupSuffix = bucketPlan.length > 1 ? ` across ${bucketPlan.length} groups` : ''
                  const leadWord    = selectedCount === 1 ? 'lead' : 'leads'
                  return `${noun} — ${selectedCount} ${leadWord} selected${groupSuffix}`
                })()}
              </h2>
              <p className={`text-xs mt-0.5 ${selectedCount > 0 ? 'text-blue-700' : 'text-gray-400'}`}>
                Creates a <strong>draft campaign only</strong>. You&apos;ll review each campaign before anything is sent.
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
                  apiBase={apiBase}
                  bucketSectionTitle="Auto-assigned campaign groups"
                />
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  <p className="font-semibold">⚠ Selected leads have no age-bucket workflow assigned</p>
                  <p className="mt-0.5">Clear these leads and re-import with a contact date column.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="px-5 py-6 text-center">
              <p className="text-sm text-gray-400">Select eligible leads in Step 2 to unlock this.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
