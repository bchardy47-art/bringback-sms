'use server'

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
import { eq, and, ne } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ImportForm } from './ImportForm'
import { BulkClearButton, MarkReviewedButton, DryRunReportPanel } from './LeadReviewControls'
import type { PilotPreviewMessage } from '@/lib/db/schema'
import { FIRST_PILOT_CAP } from '@/lib/db/schema'

// ── Style maps ────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  eligible: 'bg-emerald-100 text-emerald-700',
  warning:  'bg-amber-100 text-amber-700',
  blocked:  'bg-red-100 text-red-700',
  selected: 'bg-blue-100 text-blue-700',
  excluded: 'bg-gray-100 text-gray-400',
  pending:  'bg-gray-100 text-gray-500',
}

const STATUS_LABEL: Record<string, string> = {
  eligible: '✓ Eligible',
  warning:  '⚠ Warning',
  blocked:  '✗ Blocked',
  selected: '● Selected',
  excluded: '— Excluded',
  pending:  '… Pending',
}

const CONSENT_STYLE: Record<string, string> = {
  explicit: 'text-emerald-700',
  implied:  'text-amber-700',
  unknown:  'text-orange-600 font-semibold',  // visually distinct — blocked for first pilot
  revoked:  'text-red-600 font-semibold',
}

// Labels shown in the Consent column alongside the status value
const CONSENT_LABEL: Record<string, string> = {
  explicit: 'explicit',
  implied:  'implied',
  unknown:  'unknown ⛔ first-pilot blocked',
  revoked:  'revoked ⛔ hard block',
}

const FILTER_OPTIONS = [
  { value: '',          label: 'All' },
  { value: 'selected',  label: 'Selected' },
  { value: 'eligible',  label: 'Eligible' },
  { value: 'warning',   label: 'Warning' },
  { value: 'blocked',   label: 'Blocked' },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function PilotLeadsPage({
  searchParams,
}: {
  searchParams: { tenantId?: string; status?: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const allTenants = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .orderBy(tenants.name)

  const tenantId    = searchParams.tenantId ?? allTenants[0]?.id ?? ''
  const statusFilter = searchParams.status  ?? ''

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

  const selectedCount = allLeads.filter(r => r.importStatus === 'selected').length
  const eligibleCount = allLeads.filter(r => ['eligible', 'warning', 'selected'].includes(r.importStatus)).length
  const blockedCount  = allLeads.filter(r => r.importStatus === 'blocked').length
  const reviewedCount = allLeads.filter(r => r.reviewed).length

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pilot Lead Import + Selection</h1>
        <p className="mt-1 text-sm text-gray-500">
          Import, validate, review, and select up to {FIRST_PILOT_CAP} leads for the first SMS pilot.
          No messages are sent until the batch is approved and the Phase 13 confirmation gate is passed.
        </p>
      </div>

      {/* Tenant selector */}
      <form method="GET" className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Tenant:</label>
        <select
          name="tenantId"
          defaultValue={tenantId}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-300 focus:outline-none"
        >
          {allTenants.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
        <button type="submit" className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-medium">
          Switch
        </button>
      </form>

      {tenantId && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: 'Imported',  value: allLeads.length,  color: 'text-gray-900' },
              { label: 'Eligible',  value: eligibleCount,    color: 'text-emerald-600' },
              { label: 'Blocked',   value: blockedCount,     color: 'text-red-600' },
              { label: 'Reviewed',  value: reviewedCount,    color: 'text-gray-700' },
              {
                label: `Selected (max ${FIRST_PILOT_CAP})`,
                value: `${selectedCount} / ${FIRST_PILOT_CAP}`,
                color: selectedCount >= FIRST_PILOT_CAP ? 'text-blue-600 font-bold' : 'text-blue-600',
              },
            ].map(s => (
              <div key={s.label} className="bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-center">
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Import area */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-900">Import Leads</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Upload a CSV or enter a lead manually. Each lead is validated immediately.
              </p>
            </div>
            <div className="p-5">
              <ImportForm tenantId={tenantId} />
            </div>
          </div>

          {/* Lead review table */}
          {allLeads.length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-hidden">

              {/* Table header with filter + bulk-clear */}
              <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex flex-wrap items-center gap-3 justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">
                    Imported Leads ({displayLeads.length}{statusFilter ? ` of ${allLeads.length}` : ''})
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Select up to {FIRST_PILOT_CAP} leads. Mark each as reviewed when you&apos;ve confirmed their data.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {/* Status filter */}
                  <form method="GET" className="flex items-center gap-2">
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <label className="text-xs font-medium text-gray-600">Filter:</label>
                    <select
                      name="status"
                      defaultValue={statusFilter}
                      onChange={e => (e.currentTarget.form as HTMLFormElement).submit()}
                      className="px-2 py-1 border border-gray-300 rounded-lg text-xs focus:outline-none"
                    >
                      {FILTER_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </form>

                  {/* Bulk-clear blocked (client) */}
                  <BulkClearButton tenantId={tenantId} blockedCount={blockedCount} />

                  {selectedCount > 0 && (
                    <span className="px-2.5 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">
                      {selectedCount} selected
                    </span>
                  )}
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-gray-500 uppercase tracking-wide text-left">
                      <th className="px-4 py-2.5 w-8">✓</th>
                      <th className="px-4 py-2.5">Name</th>
                      <th className="px-4 py-2.5">Phone</th>
                      <th className="px-4 py-2.5">Consent</th>
                      <th className="px-4 py-2.5">Vehicle</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5">Issues / Warnings</th>
                      <th className="px-4 py-2.5">Preview</th>
                      <th className="px-4 py-2.5">Review</th>
                      <th className="px-4 py-2.5 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {displayLeads.map(lead => {
                      const isBlocked      = lead.importStatus === 'blocked'
                      const isSelected     = lead.importStatus === 'selected'
                      const previews       = (lead.previewMessages as PilotPreviewMessage[] | null) ?? []
                      const consentVal     = (lead.consentStatus ?? 'unknown').toLowerCase().trim()
                      const isUnknownConsent = consentVal === 'unknown' || consentVal === ''
                      // First-pilot rule: unknown consent cannot be selected (mirrors server-side gate)
                      const canSelect      = !isBlocked && !isUnknownConsent && (isSelected || selectedCount < FIRST_PILOT_CAP)

                      return (
                        <tr
                          key={lead.id}
                          className={`transition-colors ${
                            isSelected ? 'bg-blue-50' :
                            isBlocked  ? 'bg-red-50 opacity-70' :
                            lead.reviewed ? 'bg-emerald-50/40' :
                            'hover:bg-gray-50'
                          }`}
                        >
                          {/* Selection checkbox */}
                          <td className="px-4 py-3">
                            {!isBlocked && (
                              <form
                                action={`/api/admin/dlr/pilot-leads/${lead.id}`}
                                method="POST"
                              >
                                <input type="hidden" name="_method" value="PATCH" />
                                <input type="hidden" name="tenantId" value={tenantId} />
                                <input type="hidden" name="selected" value={isSelected ? 'false' : 'true'} />
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  disabled={!canSelect && !isSelected}
                                  onChange={e => (e.target.closest('form') as HTMLFormElement).submit()}
                                  className="h-4 w-4 rounded border-gray-300 text-blue-600 disabled:opacity-40"
                                />
                              </form>
                            )}
                          </td>

                          {/* Name */}
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

                          {/* Phone */}
                          <td className="px-4 py-3">
                            <p className="font-mono text-gray-700">{lead.phone ?? '—'}</p>
                            {lead.phone !== lead.phoneRaw && (
                              <p className="text-gray-400">raw: {lead.phoneRaw}</p>
                            )}
                          </td>

                          {/* Consent */}
                          <td className="px-4 py-3">
                            <p className={`font-medium ${CONSENT_STYLE[lead.consentStatus] ?? 'text-orange-600 font-semibold'}`}>
                              {CONSENT_LABEL[lead.consentStatus] ?? `${lead.consentStatus ?? 'unknown'} ⛔ first-pilot blocked`}
                            </p>
                            {lead.consentSource && <p className="text-gray-400">{lead.consentSource}</p>}
                            {lead.smsConsentNotes && <p className="text-gray-400 italic">{lead.smsConsentNotes}</p>}
                          </td>

                          {/* Vehicle */}
                          <td className="px-4 py-3 text-gray-600">
                            {lead.vehicleOfInterest
                              ? lead.vehicleOfInterest
                              : <span className="text-gray-300 italic">none — fallback ⚠</span>
                            }
                          </td>

                          {/* Status */}
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[lead.importStatus] ?? ''}`}>
                              {STATUS_LABEL[lead.importStatus] ?? lead.importStatus}
                            </span>
                          </td>

                          {/* Issues / Warnings */}
                          <td className="px-4 py-3 max-w-xs">
                            {(lead.blockedReasons as string[] | null)?.map((r, i) => (
                              <p key={i} className="text-red-600 leading-snug">✗ {r}</p>
                            ))}
                            {(lead.warnings as string[] | null)?.map((w, i) => (
                              <p key={i} className="text-amber-600 leading-snug">⚠ {w}</p>
                            ))}
                            {!lead.blockedReasons?.length && !lead.warnings?.length && (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>

                          {/* Preview */}
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

                          {/* Review (client component) */}
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

                          {/* Exclude button */}
                          <td className="px-4 py-3">
                            <form
                              action={`/api/admin/dlr/pilot-leads/${lead.id}?tenantId=${tenantId}`}
                              method="POST"
                            >
                              <input type="hidden" name="_method" value="DELETE" />
                              <button
                                type="submit"
                                title="Exclude this lead"
                                className="text-gray-300 hover:text-red-500 transition-colors text-base"
                                onClick={e => {
                                  if (!confirm('Exclude this lead from the import session?')) e.preventDefault()
                                }}
                              >
                                ×
                              </button>
                            </form>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Dry-run report (client component) */}
          {allLeads.length > 0 && (
            <DryRunReportPanel tenantId={tenantId} />
          )}

          {/* Create batch section */}
          {selectedCount > 0 && (
            <div className="border-2 border-blue-200 rounded-xl overflow-hidden">
              <div className="bg-blue-50 px-5 py-3 border-b border-blue-200">
                <h2 className="text-sm font-semibold text-blue-900">
                  Create Pilot Batch — {selectedCount} lead{selectedCount !== 1 ? 's' : ''} selected
                </h2>
                <p className="text-xs text-blue-700 mt-0.5">
                  This creates a <strong>draft</strong> batch. No sends occur until the Phase 13 confirmation gate is passed.
                </p>
              </div>
              <div className="p-5">
                <form action="/api/admin/dlr/pilot-leads/create-batch" method="POST" className="space-y-3">
                  <input type="hidden" name="tenantId" value={tenantId} />
                  {allLeads
                    .filter(r => r.importStatus === 'selected')
                    .map(r => (
                      <input key={r.id} type="hidden" name="importIds" value={r.id} />
                    ))}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Workflow <span className="text-red-500">*</span>
                    </label>
                    <select
                      name="workflowId"
                      required
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-300 focus:outline-none"
                    >
                      <option value="">— select a workflow —</option>
                      {tenantWorkflows.map(w => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                    {tenantWorkflows.length === 0 && (
                      <p className="text-xs text-amber-600 mt-1">
                        No workflows found for this tenant. Create one first.
                      </p>
                    )}
                  </div>

                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 space-y-1">
                    <p className="font-semibold">Before creating the batch, confirm:</p>
                    <p>• Every selected lead shows <strong>explicit</strong> or <strong>implied</strong> consent — unknown consent is blocked for the first pilot</p>
                    <p>• All selected leads are reviewed and consent source is recorded</p>
                    <p>• The selected workflow has correct message templates</p>
                    <p>• You understand the batch will not send until the Phase 13 gate</p>
                  </div>

                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg"
                  >
                    Create Draft Pilot Batch ({selectedCount} lead{selectedCount !== 1 ? 's' : ''}) →
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* CSV format reference */}
          <div className="rounded-lg bg-gray-50 border border-gray-200 px-5 py-4 text-xs text-gray-500 space-y-2">
            <p className="font-semibold text-gray-700">CSV column reference</p>
            <p className="font-mono">
              firstName, lastName, phone, email, vehicleName, leadSource,
              originalInquiryAt, consentStatus, consentSource, consentCapturedAt, smsConsentNotes, notes
            </p>
            <p>
              <strong>consentStatus</strong> rules for the first pilot:
            </p>
            <ul className="list-disc list-inside space-y-0.5 pl-1">
              <li><code>explicit</code> — customer checked an SMS opt-in box. Selectable.</li>
              <li><code>implied</code> — prior inquiry / established relationship. Selectable with warning.</li>
              <li><code>unknown</code> — not set. <strong className="text-orange-600">Cannot be selected or included in the first pilot batch.</strong> Update before importing.</li>
              <li><code>revoked</code> — opted out. Hard block — cannot be imported or sent to.</li>
            </ul>
            <p>
              Phone numbers are normalized to E.164 (+1XXXXXXXXXX). Invalid phones are blocked.
            </p>
          </div>

          {/* Nav links */}
          <div className="text-xs text-gray-400 space-x-3">
            <a href="/admin/dlr/pilot" className="text-blue-600 underline">Pilot Batches</a>
            <a href="/admin/dlr/live-pilot" className="text-blue-600 underline">Live Pilot</a>
            <a href="/admin/dlr/go-no-go" className="text-blue-600 underline">Go / No-Go</a>
          </div>
        </>
      )}
    </div>
  )
}
