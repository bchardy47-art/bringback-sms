'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { sendBatchAction } from './actions'

export type ClientProspect = {
  id: string
  dealershipName: string
  city: string | null
  state: string | null
  website: string | null
  bestContactName: string | null
  bestContactTitle: string | null
  publicEmail: string | null
  contactFormUrl: string | null
  sourceUrl: string | null
  priority: string
  status: string
  statusLabel: string
  statusChip: string
  lastContactedAt: string | null
  nextEligibleAt: string | null
  personalizationLine: string | null
  eligible: boolean
  eligibilityDetail: string
}

type BatchResult = {
  requested: number; capped: boolean; max: number
  sent: number; skipped: number; dryRun: number; failed: number
  perProspect: Array<{ prospectId: string; dealershipName: string; outcome: { ok: boolean; kind: string; reason?: string } }>
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

export function ProspectTableClient({
  prospects, brian, maxBatch, templateKey = 'what_is_dlr',
}: {
  prospects: ClientProspect[]
  brian: boolean
  maxBatch: number
  templateKey?: string
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<BatchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const eligibleIds = useMemo(() => prospects.filter(p => p.eligible).map(p => p.id), [prospects])
  const selectedEligible = useMemo(
    () => Array.from(selected).filter(id => eligibleIds.includes(id)),
    [selected, eligibleIds],
  )
  const overCap = selectedEligible.length > maxBatch

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function selectAllEligible() {
    setSelected(new Set(eligibleIds.slice(0, maxBatch)))
  }
  function clearSel() { setSelected(new Set()) }

  function runBatch() {
    setError(null); setResult(null)
    startTransition(async () => {
      const res = await sendBatchAction(selectedEligible, templateKey)
      if (!res.ok) { setError(res.error ?? 'Batch failed'); return }
      setResult(res.result ?? null)
      setConfirming(false)
      setSelected(new Set())
    })
  }

  return (
    <div className="space-y-3">
      {/* Batch action bar (Brian only) */}
      {brian && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={selectAllEligible} className="px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50">
            Select eligible (max {maxBatch})
          </button>
          {selected.size > 0 && (
            <button onClick={clearSel} className="px-3 py-1.5 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
              Clear ({selected.size})
            </button>
          )}
          <span className="text-xs text-gray-500">
            {selectedEligible.length} eligible selected
            {selected.size > selectedEligible.length && ` · ${selected.size - selectedEligible.length} ineligible ignored`}
          </span>
          <div className="ml-auto">
            <button
              disabled={selectedEligible.length === 0 || pending}
              onClick={() => setConfirming(true)}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send selected monthly demo invites
            </button>
          </div>
        </div>
      )}

      {overCap && (
        <p className="text-xs text-red-600">
          Over the batch cap of {maxBatch}. Only the first {maxBatch} will be sent.
        </p>
      )}

      {/* Confirm panel — shows what will send and what will be skipped */}
      {confirming && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2">
          <p className="text-sm font-semibold text-red-800">
            Send the monthly demo invite to {Math.min(selectedEligible.length, maxBatch)} dealership{selectedEligible.length === 1 ? '' : 's'}?
          </p>
          <p className="text-xs text-red-700">
            Real emails go out only if <code>OUTREACH_SEND_ENABLED=true</code>. Otherwise each is logged as a dry-run.
            Anything ineligible (cooldown, no source, suppressed) is skipped and logged.
          </p>
          <div className="flex gap-2 pt-1">
            <button onClick={runBatch} disabled={pending} className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50">
              {pending ? 'Sending…' : 'Confirm send'}
            </button>
            <button onClick={() => setConfirming(false)} disabled={pending} className="px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-white">
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {result && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm font-semibold text-gray-900 mb-1">Batch complete</p>
          <p className="text-xs text-gray-600">
            {result.sent} sent · {result.dryRun} dry-run · {result.skipped} skipped · {result.failed} failed
            {result.capped && ` · capped at ${result.max}`}
          </p>
          <ul className="mt-2 max-h-40 overflow-y-auto text-xs divide-y divide-gray-100">
            {result.perProspect.map(r => (
              <li key={r.prospectId} className="py-1 flex justify-between gap-3">
                <span className="text-gray-700 truncate">{r.dealershipName}</span>
                <span className={r.outcome.ok ? 'text-emerald-600' : 'text-gray-500'}>
                  {r.outcome.kind}{r.outcome.reason ? ` · ${r.outcome.reason}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[920px]">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider text-left">
            <tr>
              {brian && <th className="px-3 py-3 w-8" />}
              <th className="px-3 py-3">Dealership</th>
              <th className="px-3 py-3">Contact</th>
              <th className="px-3 py-3">Email</th>
              <th className="px-3 py-3">Source</th>
              <th className="px-3 py-3">Pri</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Last</th>
              <th className="px-3 py-3">Next</th>
              <th className="px-3 py-3">Eligible</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {prospects.length === 0 && (
              <tr><td colSpan={brian ? 11 : 10} className="px-3 py-8 text-center text-gray-400 text-sm">No prospects match.</td></tr>
            )}
            {prospects.map(p => (
              <tr key={p.id} className="hover:bg-gray-50">
                {brian && (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      disabled={!p.eligible}
                      onChange={() => toggle(p.id)}
                      title={p.eligible ? 'Select for batch' : p.eligibilityDetail}
                      className="rounded border-gray-300"
                    />
                  </td>
                )}
                <td className="px-3 py-2">
                  <Link href={`/admin/outreach/prospects/${p.id}`} className="font-semibold text-gray-900 hover:text-red-600">
                    {p.dealershipName}
                  </Link>
                  <div className="text-xs text-gray-400">{[p.city, p.state].filter(Boolean).join(', ') || '—'}</div>
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {p.bestContactName || '—'}
                  {p.bestContactTitle && <div className="text-gray-400">{p.bestContactTitle}</div>}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600 truncate max-w-[180px]">{p.publicEmail || <span className="text-orange-500">none</span>}</td>
                <td className="px-3 py-2 text-xs">
                  {p.sourceUrl
                    ? <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">source</a>
                    : <span className="text-orange-500">missing</span>}
                </td>
                <td className="px-3 py-2 text-xs font-mono text-gray-600">{p.priority}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${p.statusChip}`}>{p.statusLabel}</span>
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">{fmtDate(p.lastContactedAt)}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{fmtDate(p.nextEligibleAt)}</td>
                <td className="px-3 py-2">
                  {p.eligible
                    ? <span className="text-xs font-semibold text-emerald-600">● ready</span>
                    : <span className="text-xs text-gray-400" title={p.eligibilityDetail}>○ no</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/admin/outreach/prospects/${p.id}`} className="text-xs font-semibold text-red-600 hover:text-red-700">Open →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
