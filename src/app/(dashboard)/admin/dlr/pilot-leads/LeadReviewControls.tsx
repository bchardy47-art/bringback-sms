'use client'

/**
 * Phase 15 — Pilot Prep UX + Dry-Run Review
 *
 * Client component for:
 *   - Bulk-clear blocked imports
 *   - Mark individual lead as reviewed
 *   - Fetch and display dry-run report
 */

import { useState } from 'react'
import type { PilotImportDryRunReport } from '@/lib/db/schema'

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
