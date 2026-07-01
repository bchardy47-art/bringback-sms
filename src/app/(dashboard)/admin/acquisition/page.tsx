/**
 * /admin/acquisition — Dealer Acquisition Command Center (V1).
 *
 * Internal CRM view over dealer_prospects. Tracks the funnel toward 20 paid
 * dealerships: cards + a filterable pipeline table with per-row quick actions.
 * Admin-viewable; all mutations re-assert admin server-side (actions.ts).
 * Pure server component — actions run via <form action> + native <details>.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAdminUser } from '@/lib/admin/access'
import { trackEvent } from '@/lib/activity/track'
import { pipelineStageValues } from '@/lib/db/schema'
import {
  getAcquisitionOverview, pipelineLabel, pipelineChipClass,
  PIPELINE_LABELS, GOAL_PAID_DEALERS, type AcquisitionRow,
} from '@/lib/outreach/acquisition'
import {
  markEmailSentAction, markCallAttemptedAction, markInterestedAction,
  startPilotAction, markPaidAction, markLostAction, addNoteAction,
  setNextFollowUpAction, setPipelineStatusAction, updatePilotMetricsAction,
  createProspectAction,
} from './actions'

export const dynamic = 'force-dynamic'

type SearchParams = {
  stage?: string; state?: string; due?: string; pilots?: string; paid?: string; q?: string
}

const money = (n: number) => `$${n.toLocaleString('en-US')}`
function shortDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function toDateInput(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 10) : ''
}

export default async function AcquisitionPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getAdminUser()
  if (!user) redirect('/login?callbackUrl=/admin/acquisition')
  await trackEvent('admin_acquisition_viewed', { actor: user, path: '/admin/acquisition' })

  const filters = {
    stage: (searchParams.stage ?? '').trim() || undefined,
    state: (searchParams.state ?? '').trim() || undefined,
    due: (searchParams.due === 'due' || searchParams.due === 'overdue') ? searchParams.due : undefined,
    pilots: searchParams.pilots === '1',
    paid: searchParams.paid === '1',
    q: (searchParams.q ?? '').trim() || undefined,
  } as const

  const { stats, rows, states } = await getAcquisitionOverview(filters)

  const cards = [
    { label: `Paid Dealers / ${GOAL_PAID_DEALERS}`, value: `${stats.paidDealers}/${stats.goal}`, tone: stats.paidDealers > 0 ? 'good' : 'muted' },
    { label: 'Active Pilots', value: String(stats.activePilots), tone: stats.activePilots > 0 ? 'good' : 'muted' },
    { label: 'Interested Dealers', value: String(stats.interested), tone: stats.interested > 0 ? 'good' : 'muted' },
    { label: 'Prospects Contacted', value: String(stats.prospectsContacted), tone: 'muted' },
    { label: 'MRR', value: money(stats.mrr), tone: stats.mrr > 0 ? 'good' : 'muted' },
    { label: 'Follow-Ups Due', value: String(stats.followUpsDue), tone: stats.followUpsDue > 0 ? 'warn' : 'muted' },
  ] as const

  return (
    <div className="px-4 md:px-8 py-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Dealer Acquisition · Path to 20 paying dealerships by Dec 31, 2026</p>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Acquisition Command Center</h1>
        <p className="text-sm text-gray-500 mt-1">Track prospects → outreach → pilots → conversions. Signed in as {user.email}.</p>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {cards.map(c => (
          <div key={c.label} className={`bg-white rounded-xl border p-3 md:p-4 ${c.tone === 'warn' ? 'border-orange-200' : 'border-gray-200'}`}>
            <p className="text-xs font-medium text-gray-500">{c.label}</p>
            <p className={`text-2xl md:text-3xl font-bold mt-1 ${
              c.tone === 'good' ? 'text-emerald-600' : c.tone === 'warn' ? 'text-orange-600' : 'text-gray-900'
            }`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Add prospect */}
      <details className="bg-white rounded-xl border border-gray-200 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-gray-700">+ Add dealer prospect</summary>
        <form action={createProspectAction} className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
          <input name="dealershipName" required placeholder="Dealership name *" className={inputCls} />
          <input name="city" placeholder="City" className={inputCls} />
          <input name="state" placeholder="State" className={inputCls} />
          <input name="dealerType" placeholder="Dealer type" className={inputCls} />
          <input name="website" placeholder="Website" className={inputCls} />
          <input name="mainPhone" placeholder="Main phone" className={inputCls} />
          <input name="bestContactName" placeholder="Decision maker name" className={inputCls} />
          <input name="bestContactTitle" placeholder="Decision maker title" className={inputCls} />
          <input name="publicEmail" placeholder="Email" className={inputCls} />
          <input name="sourceUrl" placeholder="Source URL" className={`${inputCls} md:col-span-2`} />
          <input name="fitNotes" placeholder="Notes" className={`${inputCls} md:col-span-3`} />
          <div><button type="submit" className={btnPrimary}>Add prospect</button></div>
        </form>
      </details>

      {/* Filters */}
      <form method="GET" className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={filters.q ?? ''} placeholder="Search dealer / city / email / contact" className={`${inputCls} w-64`} />
        <select name="stage" defaultValue={filters.stage ?? ''} className={selectCls}>
          <option value="">All statuses</option>
          {Object.entries(PIPELINE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="state" defaultValue={filters.state ?? ''} className={selectCls}>
          <option value="">All states</option>
          {states.map(st => <option key={st} value={st}>{st}</option>)}
        </select>
        <select name="due" defaultValue={filters.due ?? ''} className={selectCls}>
          <option value="">Any follow-up</option>
          <option value="due">Follow-ups due (today/past)</option>
          <option value="overdue">Overdue only</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" name="pilots" value="1" defaultChecked={filters.pilots} /> Pilots</label>
        <label className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" name="paid" value="1" defaultChecked={filters.paid} /> Paid</label>
        <button type="submit" className={btnGhost}>Filter</button>
        <Link href="/admin/acquisition" className="px-3 py-1.5 text-sm text-gray-500 hover:underline">Reset</Link>
      </form>

      {/* Pipeline table */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Pipeline ({rows.length})</h2>
        <div className="overflow-x-auto bg-white rounded-xl border border-gray-200">
          <table className="w-full text-sm min-w-[1040px]">
            <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-3">Dealer</th>
                <th className="px-3 py-3">Location</th>
                <th className="px-3 py-3">Contact</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Last contacted</th>
                <th className="px-3 py-3">Next follow-up</th>
                <th className="px-3 py-3">Notes / source</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">No prospects match these filters.</td></tr>
              )}
              {rows.map(p => <Row key={p.id} p={p} />)}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Row({ p }: { p: AcquisitionRow }) {
  const overdue = p.nextFollowUpAt ? new Date(p.nextFollowUpAt) < new Date(new Date().setHours(0, 0, 0, 0)) : false
  return (
    <tr className="align-top hover:bg-gray-50">
      <td className="px-3 py-3">
        <p className="font-semibold text-gray-900">{p.dealershipName}</p>
        {p.dealerType && <p className="text-xs text-gray-400">{p.dealerType}</p>}
        {p.monthlyPrice != null && <p className="text-xs text-emerald-600 font-medium">{money(p.monthlyPrice)}/mo</p>}
      </td>
      <td className="px-3 py-3 text-gray-600 text-xs">{[p.city, p.state].filter(Boolean).join(', ') || '—'}</td>
      <td className="px-3 py-3 text-xs">
        {p.bestContactName ? <p className="text-gray-800">{p.bestContactName}{p.bestContactTitle ? ` · ${p.bestContactTitle}` : ''}</p> : <span className="text-gray-400">—</span>}
        {p.publicEmail && <p className="text-gray-500">{p.publicEmail}</p>}
        {p.mainPhone && <p className="text-gray-400">{p.mainPhone}</p>}
      </td>
      <td className="px-3 py-3">
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${pipelineChipClass(p.pipelineStatus)}`}>{pipelineLabel(p.pipelineStatus)}</span>
      </td>
      <td className="px-3 py-3 text-xs text-gray-500">{shortDate(p.lastContactedAt)}</td>
      <td className={`px-3 py-3 text-xs font-medium ${overdue ? 'text-red-600' : 'text-gray-600'}`}>
        {shortDate(p.nextFollowUpAt)}{overdue ? ' ⚠' : ''}
      </td>
      <td className="px-3 py-3 text-xs text-gray-500 max-w-[220px]">
        {p.fitNotes && <p className="line-clamp-2">{p.fitNotes}</p>}
        {p.sourceUrl && <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">source ↗</a>}
      </td>
      <td className="px-3 py-3">
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-red-600">Actions ▾</summary>
          <div className="mt-2 w-72 space-y-2">
            {/* One-click quick actions */}
            <div className="flex flex-wrap gap-1">
              <QuickBtn action={markEmailSentAction} id={p.id} label="Email Sent" />
              <QuickBtn action={markCallAttemptedAction} id={p.id} label="Call Attempted" />
              <QuickBtn action={markInterestedAction} id={p.id} label="Interested" />
              <QuickBtn action={startPilotAction} id={p.id} label="Start Pilot" />
            </div>

            {/* Change stage */}
            <form action={setPipelineStatusAction} className="flex gap-1">
              <input type="hidden" name="id" value={p.id} />
              <select name="stage" defaultValue={p.pipelineStatus} className={selectMini}>
                {pipelineStageValues.map(st => <option key={st} value={st}>{pipelineLabel(st)}</option>)}
              </select>
              <button className={btnMini}>Set</button>
            </form>

            {/* Next follow-up */}
            <form action={setNextFollowUpAction} className="flex gap-1">
              <input type="hidden" name="id" value={p.id} />
              <input type="date" name="date" defaultValue={toDateInput(p.nextFollowUpAt)} className={selectMini} />
              <button className={btnMini}>Follow-up</button>
            </form>

            {/* Mark Paid */}
            <form action={markPaidAction} className="flex flex-wrap items-center gap-1">
              <input type="hidden" name="id" value={p.id} />
              <input name="monthlyPrice" inputMode="numeric" placeholder="$/mo" defaultValue={p.monthlyPrice ?? ''} className={`${selectMini} w-16`} />
              <label className="flex items-center gap-1 text-[11px] text-gray-500"><input type="checkbox" name="founderPricing" /> founder</label>
              <button className={`${btnMini} bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700`}>Mark Paid</button>
            </form>

            {/* Mark Lost (reason required) */}
            <form action={markLostAction} className="flex gap-1">
              <input type="hidden" name="id" value={p.id} />
              <input name="reason" required placeholder="Lost reason *" className={`${selectMini} flex-1`} />
              <button className={`${btnMini} text-red-600 border-red-200 hover:bg-red-50`}>Lost</button>
            </form>

            {/* Add note */}
            <form action={addNoteAction} className="flex gap-1">
              <input type="hidden" name="id" value={p.id} />
              <input name="body" placeholder="Add note…" className={`${selectMini} flex-1`} />
              <button className={btnMini}>Note</button>
            </form>

            {/* Pilot metrics */}
            <details>
              <summary className="cursor-pointer text-[11px] font-medium text-gray-500">Pilot metrics</summary>
              <form action={updatePilotMetricsAction} className="mt-1 grid grid-cols-2 gap-1">
                <input type="hidden" name="id" value={p.id} />
                <NumIn name="pilotLeadCount" ph="leads" />
                <NumIn name="pilotTextsSent" ph="texts" />
                <NumIn name="pilotTotalReplies" ph="replies" />
                <NumIn name="pilotPositiveReplies" ph="pos replies" />
                <NumIn name="pilotAppointments" ph="appts" />
                <NumIn name="pilotOptOuts" ph="opt-outs" />
                <NumIn name="pilotBadNumbers" ph="bad #s" />
                <NumIn name="pilotSoldUnitsReported" ph="sold" />
                <NumIn name="estimatedValueCreated" ph="$ value" />
                <input type="date" name="pilotEndDate" className={selectMini} />
                <button className={`${btnMini} col-span-2`}>Save pilot metrics</button>
              </form>
            </details>
          </div>
        </details>
      </td>
    </tr>
  )
}

// server-action one-click button (posts just the id)
function QuickBtn({ action, id, label }: { action: (fd: FormData) => void; id: string; label: string }) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button className={btnMini}>{label}</button>
    </form>
  )
}
function NumIn({ name, ph }: { name: string; ph: string }) {
  return <input name={name} inputMode="numeric" placeholder={ph} className={selectMini} />
}

const inputCls = 'px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-100'
const selectCls = 'px-3 py-1.5 text-sm border border-gray-200 rounded-lg'
const selectMini = 'px-2 py-1 text-xs border border-gray-200 rounded-md min-w-0'
const btnPrimary = 'px-3 py-1.5 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700'
const btnGhost = 'px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50'
const btnMini = 'px-2 py-1 text-[11px] font-medium text-gray-700 border border-gray-200 rounded-md hover:bg-gray-50'
