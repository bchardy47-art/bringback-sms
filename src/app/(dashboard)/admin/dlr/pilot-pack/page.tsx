'use server'

/**
 * Phase 16 — Pilot Data Pack
 * /admin/dlr/pilot-pack
 *
 * Comprehensive pre-launch review page:
 *   - Readiness score (0–100) with category breakdown
 *   - 10DLC waiting room status with missing-field checklist
 *   - Selected leads table with consent / preview summary
 *   - Message preview panel (first message per lead)
 *   - Consent coverage visualization
 *   - Warnings & blockers aggregated from dry-run report
 *   - Export buttons for all 5 pack formats
 *
 * No sends, no enrollments, no batch status changes.
 */

import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { getPilotPackData } from '@/lib/pilot/pilot-pack'
import { ExportPanel } from './ExportPanel'
import type { PilotPreviewMessage } from '@/lib/db/schema'
import { FIRST_PILOT_CAP } from '@/lib/db/schema'

// ── Style maps ─────────────────────────────────────────────────────────────────

const WAITING_STATUS_STYLE: Record<string, { bg: string; text: string; label: string; icon: string }> = {
  ready_for_live_pilot:  { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Ready for Live Pilot',     icon: '🚀' },
  ready_when_approved:   { bg: 'bg-blue-100',    text: 'text-blue-700',    label: 'Ready When 10DLC Approved', icon: '⏳' },
  waiting_on_10dlc:      { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Waiting on 10DLC',          icon: '📋' },
  missing_tenant_info:   { bg: 'bg-orange-100',  text: 'text-orange-700',  label: 'Missing Tenant Info',       icon: '⚠️' },
  missing_consent_data:  { bg: 'bg-red-100',     text: 'text-red-700',     label: 'Missing Consent Data',      icon: '❌' },
  pilot_batch_not_ready: { bg: 'bg-gray-100',    text: 'text-gray-700',    label: 'Pilot Batch Not Ready',     icon: '🔲' },
}

const DLC_STATUS_STYLE: Record<string, string> = {
  approved:     'text-emerald-700 font-semibold',
  exempt:       'text-emerald-700 font-semibold',
  dev_override: 'text-blue-700 font-semibold',
  pending:      'text-amber-600',
  rejected:     'text-red-600 font-semibold',
  not_started:  'text-gray-500',
}

const CONSENT_STYLE: Record<string, string> = {
  explicit: 'bg-emerald-100 text-emerald-700',
  implied:  'bg-amber-100 text-amber-700',
  unknown:  'bg-gray-100 text-gray-600',
  revoked:  'bg-red-100 text-red-700',
}

const READINESS_STATUS_STYLE: Record<string, { color: string; barColor: string; label: string }> = {
  ready:           { color: 'text-emerald-700', barColor: 'bg-emerald-500', label: 'Ready' },
  needs_attention: { color: 'text-amber-700',   barColor: 'bg-amber-400',   label: 'Needs Attention' },
  in_progress:     { color: 'text-blue-700',    barColor: 'bg-blue-400',    label: 'In Progress' },
  not_started:     { color: 'text-gray-600',    barColor: 'bg-gray-300',    label: 'Not Started' },
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function PilotPackPage({
  searchParams,
}: {
  searchParams: { tenantId?: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const allTenants = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .orderBy(tenants.name)

  const tenantId = searchParams.tenantId ?? allTenants[0]?.id ?? ''

  let packData = tenantId ? await getPilotPackData(tenantId) : null
  const { tenant, workflow, batch, selectedLeads, dryRunReport, readinessScore, tenDLCWaitingStatus, workflowStepCount } = packData ?? {}

  const waitingStyle = tenDLCWaitingStatus ? (WAITING_STATUS_STYLE[tenDLCWaitingStatus] ?? WAITING_STATUS_STYLE.waiting_on_10dlc) : null
  const readinessStyle = readinessScore ? (READINESS_STATUS_STYLE[readinessScore.status] ?? READINESS_STATUS_STYLE.not_started) : null

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pilot Data Pack</h1>
        <p className="mt-1 text-sm text-gray-500">
          Complete pre-launch audit of the first SMS pilot. Review, export, and confirm readiness
          while live sending remains fully locked down.
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
        <button type="submit" className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-medium">
          Switch
        </button>
      </form>

      {tenantId && packData && readinessScore && readinessStyle && waitingStyle && tenDLCWaitingStatus && (

        <>
          {/* ── Top status bar ────────────────────────────────────────���─────── */}
          <div className="grid grid-cols-2 gap-4">

            {/* Readiness score */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-gray-700">Pilot Readiness Score</p>
                <span className={`text-2xl font-black ${readinessStyle.color}`}>
                  {readinessScore.score}<span className="text-sm font-medium text-gray-400">/100</span>
                </span>
              </div>
              {/* Score bar */}
              <div className="w-full bg-gray-100 rounded-full h-2.5 mb-3">
                <div
                  className={`h-2.5 rounded-full ${readinessStyle.barColor}`}
                  style={{ width: `${readinessScore.score}%` }}
                />
              </div>
              {/* Breakdown */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {[
                  ['Lead data',       readinessScore.breakdown.leadDataCompleteness,  15],
                  ['Consent',         readinessScore.breakdown.consentCoverage,        20],
                  ['Previews',        readinessScore.breakdown.previewCompleteness,    15],
                  ['No blockers',     readinessScore.breakdown.noBlockers,             15],
                  ['Workflow',        readinessScore.breakdown.workflowApproval,       10],
                  ['10DLC',           readinessScore.breakdown.tenDlcReadiness,        15],
                  ['Compliance',      readinessScore.breakdown.complianceHealth,       10],
                ].map(([label, val, max]) => (
                  <div key={label as string} className="flex items-center justify-between gap-2">
                    <span className="text-gray-500">{label as string}</span>
                    <span className={`font-semibold ${(val as number) === (max as number) ? 'text-emerald-600' : (val as number) > 0 ? 'text-amber-600' : 'text-red-500'}`}>
                      {val as number}/{max as number}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-gray-500 italic">
                → {readinessScore.recommendedNextAction}
              </p>
            </div>

            {/* 10DLC Waiting Room */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">{waitingStyle.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-gray-700">10DLC Waiting Room</p>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${waitingStyle.bg} ${waitingStyle.text}`}>
                    {waitingStyle.label}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5 text-xs">
                {[
                  { label: 'Overall 10DLC',   value: tenant?.tenDlcStatus ?? 'not_started' },
                  { label: 'Brand status',    value: tenant?.brandStatus   ?? 'not_started' },
                  { label: 'Campaign status', value: tenant?.campaignStatus ?? 'not_started' },
                  { label: 'Sending number',  value: tenant?.smsSendingNumber ?? '(not set)' },
                  { label: 'Campaign ID',     value: tenant?.campaignId ?? '(not set)' },
                ].map(r => (
                  <div key={r.label} className="flex justify-between">
                    <span className="text-gray-500">{r.label}</span>
                    <span className={DLC_STATUS_STYLE[r.value] ?? 'text-gray-700'}>{r.value}</span>
                  </div>
                ))}
              </div>

              {/* Missing fields */}
              {(() => {
                const missing: string[] = []
                if (!tenant?.businessLegalName) missing.push('Business legal name')
                if (!tenant?.businessAddress)   missing.push('Business address')
                if (!tenant?.businessWebsite)   missing.push('Business website')
                if (!tenant?.privacyPolicyUrl)  missing.push('Privacy policy URL')
                if (!tenant?.smsTermsUrl)       missing.push('SMS terms URL')
                if (!tenant?.smsSendingNumber)  missing.push('SMS sending number')
                if (!tenant?.ein)               missing.push('EIN / Tax ID')
                return missing.length > 0 ? (
                  <div className="border-t border-gray-100 pt-3">
                    <p className="text-xs font-semibold text-orange-700 mb-1">Missing for 10DLC:</p>
                    {missing.map(f => (
                      <p key={f} className="text-xs text-orange-600">• {f}</p>
                    ))}
                  </div>
                ) : (
                  <div className="border-t border-gray-100 pt-3">
                    <p className="text-xs text-emerald-600 font-semibold">✓ All brand fields complete</p>
                  </div>
                )
              })()}
            </div>
          </div>

          {/* ── Blockers + warnings ──────────────────────────────────────────── */}
          {(readinessScore.blockers.length > 0 || readinessScore.warnings.length > 0) && (
            <div className="grid grid-cols-2 gap-4">
              {readinessScore.blockers.length > 0 && (
                <div className="border border-red-200 rounded-xl p-4 bg-red-50">
                  <p className="text-sm font-semibold text-red-700 mb-2">Blockers ({readinessScore.blockers.length})</p>
                  {readinessScore.blockers.map((b, i) => (
                    <p key={i} className="text-xs text-red-700 mb-1">✗ {b}</p>
                  ))}
                </div>
              )}
              {readinessScore.warnings.length > 0 && (
                <div className="border border-amber-200 rounded-xl p-4 bg-amber-50">
                  <p className="text-sm font-semibold text-amber-700 mb-2">Warnings ({readinessScore.warnings.length})</p>
                  {readinessScore.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-700 mb-1">⚠ {w}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Pilot config summary ─────────────────────────────────────────── */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Pilot Configuration</h2>
            <div className="grid grid-cols-3 gap-4 text-xs">
              <div>
                <p className="text-gray-500 uppercase tracking-wide mb-1">Tenant</p>
                <p className="font-semibold text-gray-800">{tenant?.name}</p>
                <p className="text-gray-400 font-mono">{tenant?.id.slice(0, 8)}…</p>
              </div>
              <div>
                <p className="text-gray-500 uppercase tracking-wide mb-1">Workflow</p>
                <p className="font-semibold text-gray-800">{workflow?.name ?? '(none)'}</p>
                {workflow && (
                  <p className="text-gray-400">{workflowStepCount} SMS step{workflowStepCount !== 1 ? 's' : ''} · {workflow.approvedForLive ? '✓ approved' : '⚠ not approved'}</p>
                )}
              </div>
              <div>
                <p className="text-gray-500 uppercase tracking-wide mb-1">Batch</p>
                <p className="font-semibold text-gray-800">{batch ? `${batch.status} · ${batch.isFirstPilot ? 'first pilot' : 'standard'}` : '(none)'}</p>
                {batch && (
                  <p className="text-gray-400 font-mono">{batch.id.slice(0, 8)}…</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Selected leads table ──────────────────────────────────────────── */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  Selected Leads ({(selectedLeads ?? []).length} of {FIRST_PILOT_CAP})
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  These leads will be included in the first pilot batch.
                </p>
              </div>
              {/* Consent breakdown pills */}
              {dryRunReport && (
                <div className="flex gap-1.5 flex-wrap justify-end">
                  {Object.entries(dryRunReport.consentCoverage).map(([status, count]) => (
                    <span key={status} className={`px-2 py-0.5 rounded-full text-xs font-semibold ${CONSENT_STYLE[status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {status}: {count}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {(selectedLeads ?? []).length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-gray-500 uppercase tracking-wide text-left">
                      <th className="px-4 py-2.5">Name</th>
                      <th className="px-4 py-2.5">Phone</th>
                      <th className="px-4 py-2.5">Consent</th>
                      <th className="px-4 py-2.5">Vehicle</th>
                      <th className="px-4 py-2.5">Reviewed</th>
                      <th className="px-4 py-2.5">Preview (step 1)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(selectedLeads ?? []).map(lead => {
                      const previews = (lead.previewMessages as PilotPreviewMessage[] | null) ?? []
                      const firstMsg = previews[0]?.rendered
                      const hasFallback = previews.some(p => p.usedFallback)
                      const hasOptOut = previews.some(p =>
                        /reply\s+stop|stop\s+to\s+(unsubscribe|opt.out)/i.test(p.rendered ?? '')
                      )

                      return (
                        <tr key={lead.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-semibold text-gray-800">
                            {lead.firstName} {lead.lastName}
                            {lead.reviewed && <span className="ml-1 text-emerald-600">✓</span>}
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-600">{lead.phone ?? '—'}</td>
                          <td className="px-4 py-3">
                            <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${CONSENT_STYLE[lead.consentStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                              {lead.consentStatus}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {lead.vehicleOfInterest ?? <span className="text-gray-300 italic">none</span>}
                            {hasFallback && <span className="ml-1 text-amber-500 text-xs">⚠ fallback</span>}
                          </td>
                          <td className="px-4 py-3">
                            {lead.reviewed
                              ? <span className="text-emerald-600 font-semibold text-xs">✓ Reviewed</span>
                              : <span className="text-gray-400 text-xs">Pending</span>
                            }
                          </td>
                          <td className="px-4 py-3 max-w-xs">
                            {firstMsg ? (
                              <div>
                                <p className="text-gray-700 leading-snug line-clamp-3">
                                  {firstMsg.slice(0, 140)}{firstMsg.length > 140 ? '…' : ''}
                                </p>
                                {hasOptOut && <span className="text-emerald-600 text-xs">✓ opt-out footer</span>}
                              </div>
                            ) : (
                              <span className="text-amber-500 italic">no preview yet</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-5 py-8 text-center text-sm text-gray-400">
                No leads selected yet.{' '}
                <a href="/admin/dlr/pilot-leads" className="text-blue-600 underline">
                  Go to Pilot Leads →
                </a>
              </div>
            )}
          </div>

          {/* ── Dry-run recommendation ─────────────────────���──────────────────── */}
          {dryRunReport && (
            <div className={`rounded-xl border px-5 py-4 ${
              dryRunReport.recommendation === 'ready'        ? 'bg-emerald-50 border-emerald-200' :
              dryRunReport.recommendation === 'fix_warnings' ? 'bg-amber-50 border-amber-200' :
              'bg-red-50 border-red-200'
            }`}>
              <p className={`text-sm font-bold ${
                dryRunReport.recommendation === 'ready'        ? 'text-emerald-700' :
                dryRunReport.recommendation === 'fix_warnings' ? 'text-amber-700' :
                'text-red-700'
              }`}>
                {dryRunReport.recommendation === 'ready'        ? '✅ Dry-run: Ready' :
                 dryRunReport.recommendation === 'fix_warnings' ? '⚠ Dry-run: Fix Warnings' :
                 '✗ Dry-run: Blocked'}
              </p>
              <p className="text-xs text-gray-700 mt-1">{dryRunReport.recommendationReason}</p>
              <div className="mt-2 grid grid-cols-5 gap-2 text-center text-xs">
                {[
                  { label: 'Selected',   value: dryRunReport.selectedCount,  color: 'text-blue-600' },
                  { label: 'Eligible',   value: dryRunReport.eligibleCount,  color: 'text-emerald-600' },
                  { label: 'Warnings',   value: dryRunReport.warningCount,   color: 'text-amber-600' },
                  { label: 'Blocked',    value: dryRunReport.blockedCount,   color: 'text-red-600' },
                  { label: 'Reviewed',   value: dryRunReport.reviewedCount,  color: 'text-gray-700' },
                ].map(s => (
                  <div key={s.label} className="bg-white/70 rounded-lg py-1.5">
                    <p className={`text-base font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-gray-400">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 10DLC notes ─────────────────────────────────────────────────��─── */}
          {tenant?.tenDlcStatusNotes && (
            <div className="border border-gray-200 rounded-xl px-5 py-4 bg-gray-50">
              <p className="text-xs font-semibold text-gray-700 mb-1">10DLC Notes</p>
              <p className="text-xs text-gray-600 whitespace-pre-wrap">{tenant.tenDlcStatusNotes}</p>
            </div>
          )}

          {/* ── Export panel ─────────────────────────────────────────────────── */}
          <ExportPanel tenantId={tenantId} />

          {/* ── Nav links ────────────────────────────────────────────────────── */}
          <div className="text-xs text-gray-400 space-x-3">
            <a href="/admin/dlr/pilot-leads" className="text-blue-600 underline">Pilot Leads</a>
            <a href="/admin/dlr/pilot"       className="text-blue-600 underline">Pilot Batches</a>
            <a href="/admin/dlr/go-no-go"    className="text-blue-600 underline">Go / No-Go</a>
            <a href="/admin/dlr/readiness"   className="text-blue-600 underline">Readiness</a>
            <a href="/admin/dlr/production"  className="text-blue-600 underline">Production Env</a>
          </div>
        </>
      )}

      {/* Empty state */}
      {tenantId && !packData && (
        <div className="text-center py-16 text-sm text-gray-400">
          No data available for this tenant.
        </div>
      )}
    </div>
  )
}
