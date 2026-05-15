'use client'

/**
 * Phase 15 — Pilot Prep UX + Dry-Run Review
 *
 * Client components for:
 *   - Status filter select (auto-submits on change)
 *   - Lead selection checkbox
 *   - Exclude-with-confirm button
 *   - Bulk-clear blocked imports
 *   - Mark individual lead as reviewed
 *   - Fetch and display dry-run report
 */

import { useState, useEffect } from 'react'
import type { PilotImportDryRunReport } from '@/lib/db/schema'

// ── Auto-Select All Eligible ──────────────────────────────────────────────────
// Fires once on mount when eligible leads exist but none are selected yet.
// Eliminates manual checkbox work for the happy-path import flow.

export function AutoSelectEligible({ tenantId }: { tenantId: string }) {
  useEffect(() => {
    // One-shot guard: if this session already auto-selected for this tenant,
    // don't fire again — preserves intentional deselections after a reload.
    const flagKey = `dlr-auto-selected:${tenantId}`
    if (sessionStorage.getItem(flagKey)) return

    sessionStorage.setItem(flagKey, '1')
    fetch('/api/admin/dlr/pilot-leads/select-all-eligible', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId }),
    })
      .then(() => window.location.reload())
      .catch(() => {}) // fail silently — page still works, dealer can select manually
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Render a subtle loading hint while the request fires
  return (
    <p className="text-xs text-gray-400 animate-pulse">
      Auto-selecting eligible leads…
    </p>
  )
}

// ── Bulk Clear ────────────────────────────────────────────────────────────────

export function BulkClearButton({ tenantId, blockedCount }: { tenantId: string; blockedCount: number }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<string | null>(null)

  if (blockedCount === 0) return null

  async function handleClear() {
    if (!confirm(`Exclude all ${blockedCount} blocked lead${blockedCount === 1 ? '' : 's'} from this import session?`)) return
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/admin/dlr/pilot-leads/bulk-clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      const data = await res.json() as { ok?: boolean; cleared?: number; error?: string }
      if (data.ok) {
        setResult(`✓ Cleared ${data.cleared} blocked lead${(data.cleared ?? 0) === 1 ? '' : 's'}`)
        setTimeout(() => window.location.reload(), 800)
      } else {
        setResult(`Error: ${data.error}`)
      }
    } catch {
      setResult('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleClear}
        disabled={loading}
        className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-semibold rounded-lg disabled:opacity-50"
      >
        {loading ? 'Clearing…' : `Clear ${blockedCount} Blocked`}
      </button>
      {result && <span className="text-xs text-gray-600">{result}</span>}
    </div>
  )
}

// ── Mark Reviewed ─────────────────────────────────────────────────────────────

export function MarkReviewedButton({
  importId,
  tenantId,
  alreadyReviewed,
}: {
  importId: string
  tenantId: string
  alreadyReviewed: boolean
}) {
  const [done, setDone]     = useState(alreadyReviewed)
  const [loading, setLoading] = useState(false)

  if (done) {
    return <span className="text-emerald-600 text-xs font-semibold">✓ Reviewed</span>
  }

  async function handle() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/dlr/pilot-leads/${importId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (data.ok) setDone(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handle}
      disabled={loading}
      className="text-xs text-gray-400 hover:text-emerald-600 underline disabled:opacity-50"
    >
      {loading ? '…' : 'Mark reviewed'}
    </button>
  )
}

// ── Dry-Run Report ────────────────────────────────────────────────────────────

const RECOMMENDATION_STYLE = {
  ready:         { bar: 'bg-emerald-500', text: 'text-emerald-700', label: '✅ Ready to create pilot batch' },
  fix_warnings:  { bar: 'bg-amber-400',   text: 'text-amber-700',   label: '⚠ Fix warnings before proceeding' },
  blocked:       { bar: 'bg-red-500',     text: 'text-red-700',     label: '✗ Blocked — resolve issues first' },
}

export function DryRunReportPanel({ tenantId }: { tenantId: string }) {
  const [report, setReport]   = useState<PilotImportDryRunReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function fetchReport() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/dlr/pilot-leads/dry-run?tenantId=${tenantId}`)
      const data = await res.json() as { report?: PilotImportDryRunReport; error?: string }
      if (data.report) setReport(data.report)
      else setError(data.error ?? 'Unknown error')
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  const style = report ? (RECOMMENDATION_STYLE[report.recommendation] ?? RECOMMENDATION_STYLE.fix_warnings) : null

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Dry-Run Report</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Generates a read-only report of current import status. No sends, no enrollments.
          </p>
        </div>
        <button
          onClick={fetchReport}
          disabled={loading}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
        >
          {loading ? 'Generating…' : report ? 'Refresh Report' : 'Generate Report'}
        </button>
      </div>

      {error && (
        <div className="px-5 py-3 text-sm text-red-600">Error: {error}</div>
      )}

      {report && style && (
        <div className="p-5 space-y-5">

          {/* Recommendation banner */}
          <div className={`rounded-lg border-l-4 ${style.bar} bg-white shadow-sm px-4 py-3`}>
            <p className={`text-sm font-bold ${style.text}`}>{style.label}</p>
            <p className="text-xs text-gray-600 mt-0.5">{report.recommendationReason}</p>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-4 gap-3 text-center">
            {[
              { label: 'Total',     value: report.totalImported, color: 'text-gray-900' },
              { label: 'Selected',  value: report.selectedCount, color: 'text-blue-600' },
              { label: 'Eligible',  value: report.eligibleCount, color: 'text-emerald-600' },
              { label: 'Warnings',  value: report.warningCount,  color: 'text-amber-600' },
              { label: 'Blocked',   value: report.blockedCount,  color: 'text-red-600' },
              { label: 'Reviewed',  value: report.reviewedCount, color: 'text-gray-700' },
              { label: 'Duplicates',value: report.duplicateCount,color: 'text-orange-600' },
              { label: 'Fallbacks', value: report.fallbackCount, color: 'text-purple-600' },
            ].map(s => (
              <div key={s.label} className="bg-gray-50 border border-gray-100 rounded-lg px-2 py-2">
                <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Consent coverage */}
          {Object.keys(report.consentCoverage).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-2">Consent Coverage</p>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(report.consentCoverage).map(([status, count]) => (
                  <span
                    key={status}
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      status === 'explicit' ? 'bg-emerald-100 text-emerald-700' :
                      status === 'implied'  ? 'bg-amber-100 text-amber-700' :
                      status === 'revoked'  ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {status}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Per-lead table */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2">Lead Details</p>
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase tracking-wide text-left">
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Consent</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Flags</th>
                    <th className="px-3 py-2">First Message Preview</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {report.leads.map(lead => (
                    <tr key={lead.importId} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-800">
                        {lead.firstName} {lead.lastName}
                        {lead.reviewed && <span className="ml-1 text-emerald-600 font-semibold">✓</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-600">{lead.phone ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{lead.consentStatus}</td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                          lead.importStatus === 'selected' ? 'bg-blue-100 text-blue-700' :
                          lead.importStatus === 'eligible' ? 'bg-emerald-100 text-emerald-700' :
                          lead.importStatus === 'warning'  ? 'bg-amber-100 text-amber-700' :
                          lead.importStatus === 'blocked'  ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {lead.importStatus}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-500">
                        {lead.isDuplicate && <span className="mr-1">🔁</span>}
                        {lead.hasFallback && <span className="mr-1">⚠️</span>}
                        {lead.blockedReasons.length > 0 && (
                          <span className="text-red-600" title={lead.blockedReasons.join('; ')}>✗</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-600 max-w-xs">
                        {lead.firstMessage
                          ? <span>{lead.firstMessage.slice(0, 100)}{lead.firstMessage.length > 100 ? '…' : ''}</span>
                          : <span className="text-gray-300 italic">no preview</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-gray-400">
            Generated: {new Date(report.generatedAt).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Status Filter Select ───────────────────────────────────────────────────────
// Must be a client component — contains an onChange handler.

const FILTER_OPTIONS = [
  { value: '',             label: 'All' },
  { value: 'selected',     label: 'Selected' },
  { value: 'eligible',     label: 'Eligible' },
  { value: 'warning',      label: 'Warning' },
  { value: 'held',         label: 'Held' },
  { value: 'needs_review', label: 'Needs Review' },
  { value: 'blocked',      label: 'Blocked' },
]

export function StatusFilterSelect({
  tenantId,
  statusFilter,
}: {
  tenantId: string
  statusFilter: string
}) {
  return (
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
  )
}

// ── Lead Selection Checkbox ───────────────────────────────────────────────────
// Must be a client component — uses fetch to avoid full-page navigation.

export function LeadCheckbox({
  leadId,
  tenantId,
  isSelected,
  canSelect,
}: {
  leadId: string
  tenantId: string
  isSelected: boolean
  canSelect: boolean
}) {
  const [loading, setLoading] = useState(false)

  async function handleChange() {
    if (loading) return
    setLoading(true)
    try {
      await fetch(`/api/admin/dlr/pilot-leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, selected: !isSelected }),
      })
      window.location.reload()
    } catch {
      // ignore — reload anyway to sync state
      window.location.reload()
    } finally {
      setLoading(false)
    }
  }

  return (
    <input
      type="checkbox"
      checked={isSelected}
      disabled={(!canSelect && !isSelected) || loading}
      onChange={handleChange}
      className="h-4 w-4 rounded border-gray-300 text-blue-600 disabled:opacity-40 cursor-pointer"
    />
  )
}

// ── Exclude Button ─────────────────────────────────────────────────────────────
// Must be a client component — uses fetch to avoid full-page navigation.

export function ExcludeButton({
  leadId,
  tenantId,
}: {
  leadId: string
  tenantId: string
}) {
  const [loading, setLoading] = useState(false)

  async function handleExclude() {
    if (!confirm('Exclude this lead from the import session?')) return
    setLoading(true)
    try {
      await fetch(`/api/admin/dlr/pilot-leads/${leadId}?tenantId=${tenantId}`, {
        method: 'DELETE',
      })
      window.location.reload()
    } catch {
      window.location.reload()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleExclude}
      disabled={loading}
      title="Exclude this lead"
      className="text-gray-300 hover:text-red-500 transition-colors text-base disabled:opacity-40"
    >
      ×
    </button>
  )
}

// ── Create Batch Button ────────────────────────────────────────────────────────
// Auto-assigns leads to bucket workflows — no manual workflow selection needed.

export type BucketPlanItem = {
  workflowId:   string
  workflowName: string
  ageBucket:    string | null
  bucketLabel:  string
  leadCount:    number
}

export function CreateBatchButton({
  tenantId,
  importIds,
  bucketPlan,
  compact = false,
}: {
  tenantId:   string
  importIds:  string[]
  bucketPlan: BucketPlanItem[]
  compact?:   boolean
}) {
  const [stage,   setStage]   = useState<'idle' | 'confirming' | 'loading'>('idle')
  const [error,   setError]   = useState<string | null>(null)

  const totalLeads = bucketPlan.reduce((s, b) => s + b.leadCount, 0)

  async function handleConfirm() {
    setStage('loading')
    setError(null)
    try {
      const res  = await fetch('/api/admin/dlr/pilot-leads/create-batch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tenantId, importIds }),
      })
      const data = await res.json() as {
        ok?:      boolean
        batches?: Array<{ batchId: string }>
        error?:   string
      }
      if (data.ok && data.batches?.length) {
        // Navigate to batch queue showing ALL newly created batches, not just the first
        const ids = data.batches.map((b: { batchId: string }) => b.batchId).join(',')
        window.location.href =
          `/admin/dlr/pilot-leads/batch-queue` +
          `?tenantId=${encodeURIComponent(tenantId)}` +
          `&ids=${encodeURIComponent(ids)}`
      } else {
        setError(data.error ?? 'Unknown error')
        setStage('idle')
      }
    } catch {
      setError('Network error — please try again')
      setStage('idle')
    }
  }

  // ── Compact variant (used in the top-of-page CTA panel) ──────────────────
  if (compact) {
    return (
      <div className="space-y-3">
        {stage === 'confirming' ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 space-y-2">
            <p className="text-xs font-semibold text-blue-900">
              Ready to create {bucketPlan.length} draft batch{bucketPlan.length !== 1 ? 'es' : ''} for {totalLeads} lead{totalLeads !== 1 ? 's' : ''}.
            </p>
            <p className="text-xs text-blue-700">
              No messages will be sent — batches are draft only until you approve each one.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleConfirm}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition-colors"
              >
                Yes, create pilot →
              </button>
              <button
                onClick={() => setStage('idle')}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setStage('confirming')}
            disabled={stage === 'loading'}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-bold rounded-xl transition-colors shadow-sm"
          >
            {stage === 'loading' ? 'Creating…' : `Create Recommended Pilot (${totalLeads} lead${totalLeads !== 1 ? 's' : ''}) →`}
          </button>
        )}
        {error && <p className="text-sm text-red-600 font-medium">⚠ {error}</p>}
      </div>
    )
  }

  // ── Full variant (used in Step 3 at the bottom) ────────────────────────────
  return (
    <div className="space-y-4">
      {/* Bucket plan summary */}
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
          <p className="text-xs font-semibold text-gray-700">Auto-assigned bucket workflows</p>
        </div>
        <table className="w-full text-xs">
          <tbody className="divide-y divide-gray-100">
            {bucketPlan.map(b => (
              <tr key={b.workflowId} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 font-medium text-gray-700 w-32">{b.bucketLabel}</td>
                <td className="px-4 py-2.5 text-gray-600">{b.workflowName}</td>
                <td className="px-4 py-2.5 text-right text-gray-500">
                  {b.leadCount} lead{b.leadCount === 1 ? '' : 's'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {stage === 'confirming' ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-blue-900">
            This will create {bucketPlan.length} draft batch{bucketPlan.length !== 1 ? 'es' : ''}.
            No messages will be sent until each batch is reviewed and approved.
          </p>
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleConfirm}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition-colors"
            >
              Yes, create pilot →
            </button>
            <button
              onClick={() => setStage('idle')}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-600 space-y-1">
            <p>• Every selected lead has <strong>explicit</strong> or <strong>implied</strong> consent on file</p>
            <p>• Each bucket workflow has correct message templates for this dealer</p>
          </div>

          <button
            onClick={() => setStage('confirming')}
            disabled={stage === 'loading'}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-bold rounded-lg transition-colors"
          >
            {stage === 'loading'
              ? 'Creating…'
              : `Create Recommended Pilot (${totalLeads} lead${totalLeads !== 1 ? 's' : ''}) →`
            }
          </button>
        </>
      )}

      {error && (
        <p className="text-sm text-red-600 font-medium">⚠ {error}</p>
      )}
    </div>
  )
}
