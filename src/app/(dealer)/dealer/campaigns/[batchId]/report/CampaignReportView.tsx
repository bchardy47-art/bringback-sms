/**
 * CampaignReportView — server component, pure presentation.
 *
 * Renders a CampaignReport (from src/lib/pilot/campaign-report.ts) using
 * the same Tailwind patterns as the existing pilot batch + dealer batch
 * pages. Used by both the dealer page and the admin page.
 *
 * No client interactivity — the CSV download is a plain <a href>.
 */

import type { CampaignReport } from '@/lib/pilot/campaign-report'

type Props = {
  report: CampaignReport
  /** Where the CSV export lives — dealer and admin point to different routes. */
  exportHref: string
  /** Top-of-page back link. */
  backHref: string
  backLabel: string
  /** When true, render tenant name in the header (admin view). */
  showTenant: boolean
}

const STATUS_COLOR: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-600',
  previewed: 'bg-blue-100 text-blue-700',
  approved:  'bg-teal-100 text-teal-700',
  sending:   'bg-green-100 text-green-700',
  paused:    'bg-yellow-100 text-yellow-700',
  completed: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-100 text-red-600',
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function fmtPct(rate: number | null): string {
  if (rate == null) return '—'
  return `${(rate * 100).toFixed(1)}%`
}

export default function CampaignReportView({
  report,
  exportHref,
  backHref,
  backLabel,
  showTenant,
}: Props) {
  const noMessages = report.messagesSent + report.messagesDelivered + report.messagesQueued + report.messagesFailed === 0
  const noReplies = report.repliesReceived === 0
  const noHotLeads = report.hotLeads.length === 0
  const noHandoffs = report.handoffsCreated === 0

  return (
    <div className="px-8 py-6 max-w-6xl mx-auto space-y-8">

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">Campaign Report</h1>
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLOR[report.status] ?? 'bg-gray-100'}`}>
              {report.status}
            </span>
          </div>
          <p className="text-sm text-gray-600 mt-1">
            {showTenant && <span className="font-semibold">{report.tenantName} · </span>}
            <span>{report.workflowName}</span>
          </p>
          <p className="text-xs text-gray-400 mt-0.5 font-mono">{report.batchId}</p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={exportHref}
            className="px-3 py-2 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            Export CSV
          </a>
          <a
            href={backHref}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700"
          >
            ← {backLabel}
          </a>
        </div>
      </div>

      {/* ── Campaign summary ─────────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-xl px-6 py-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Campaign Overview
        </p>
        <p className="text-sm text-gray-800 leading-relaxed">{report.managerSummary}</p>
      </section>

      {/* ── Top-line stat cards ──────────────────────────────────────── */}
      <section>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard label="In batch"          value={report.totalLeadsInBatch} />
          <StatCard label="Sent"              value={report.messagesSent + report.messagesDelivered} color="text-green-700" />
          <StatCard label="Delivered"         value={report.messagesDelivered} color="text-green-700" />
          <StatCard label="Replies"           value={report.repliesReceived} color="text-blue-600" />
          <StatCard label="Reply rate"        value={fmtPct(report.replyRate)} color="text-blue-600" />
          <StatCard label="Opt-outs"          value={report.optOuts} color={report.optOuts > 0 ? 'text-red-600' : 'text-gray-500'} />
          <StatCard label="Hot leads"          value={report.classification.hot} color="text-orange-600" />
          <StatCard label="Warm replies"       value={report.classification.warm} color="text-amber-600" />
          <StatCard label="Needs follow-up"    value={report.classification.needsHuman} color="text-purple-600" />
          <StatCard label="Follow-ups created" value={report.handoffsCreated} color="text-orange-500" />
          <StatCard label="Follow-ups resolved" value={report.handoffsResolved} color="text-teal-600" />
          <StatCard label="Failed"             value={report.messagesFailed} color={report.messagesFailed > 0 ? 'text-red-600' : 'text-gray-500'} />
        </div>
      </section>

      {/* ── Timing strip ─────────────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-xl px-5 py-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Started</p>
            <p className="font-semibold text-gray-800">{fmtDateTime(report.startedAt)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Last activity</p>
            <p className="font-semibold text-gray-800">{fmtDateTime(report.lastActivityAt)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">
              {report.cancelledAt ? 'Cancelled' : 'Completed'}
            </p>
            <p className="font-semibold text-gray-800">
              {fmtDateTime(report.cancelledAt ?? report.completedAt)}
            </p>
          </div>
        </div>
      </section>

      {/* ── Funnel ───────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Funnel</h2>
        {noMessages ? (
          <EmptyState text="No messages yet — funnel will populate after the first send." />
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
            {report.funnel.map(step => {
              const top = report.funnel[0]?.value ?? 1
              const pct = top > 0 ? Math.max(2, (step.value / top) * 100) : 0
              return (
                <div key={step.label} className="grid grid-cols-[140px_1fr_60px] items-center gap-3">
                  <span className="text-xs text-gray-600">{step.label}</span>
                  <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div
                      className="h-full bg-blue-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-right text-gray-700">{step.value}</span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Import stats (best-effort) ───────────────────────────────── */}
      {report.importStats.hasImportData && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Import Stats</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Imported"      value={report.importStats.totalImported ?? 0} />
            <StatCard label="Eligible"      value={report.importStats.eligible ?? 0}     color="text-green-700" />
            <StatCard label="Suppressed"    value={report.importStats.suppressed ?? 0}   color="text-gray-500" />
            <StatCard label="Duplicates"    value={report.importStats.duplicates ?? 0}   color="text-amber-700" />
            <StatCard label="Invalid phone" value={report.importStats.invalidPhone ?? 0} color="text-red-600" />
          </div>
        </section>
      )}

      {/* ── Reply classification breakdown ───────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Reply Classification</h2>
        {noReplies ? (
          <EmptyState text="No replies yet — groups will populate as leads respond." />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard label="Hot"              value={report.classification.hot}             color="text-orange-600" />
            <StatCard label="Warm"             value={report.classification.warm}            color="text-amber-600" />
            <StatCard label="Needs follow-up"  value={report.classification.needsHuman}      color="text-purple-600" />
            <StatCard label="Not now"          value={report.classification.notNow}          color="text-gray-500" />
            <StatCard label="Neutral/unclear"  value={report.classification.neutralUnclear}  color="text-gray-500" />
            <StatCard label="Not interested"   value={report.classification.notInterested}   color="text-gray-500" />
            <StatCard label="Bought elsewhere" value={report.classification.alreadyBought}   color="text-gray-500" />
            <StatCard label="Bad number"       value={report.classification.wrongNumber}     color="text-gray-500" />
            <StatCard label="Complaint"        value={report.classification.angryOrComplaint} color={report.classification.angryOrComplaint > 0 ? 'text-red-600' : 'text-gray-500'} />
          </div>
        )}
      </section>

      {/* ── Hot leads table ──────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Hot Leads ({report.hotLeads.length})
        </h2>
        {noHotLeads ? (
          <EmptyState text="No hot leads yet — these are the buying-now signals (appointment, inventory, payment)." />
        ) : (
          <LeadTable rows={report.hotLeads} highlight="hot" />
        )}
      </section>

      {/* ── Needs-human table ────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Needs Follow-up ({report.needsHumanLeads.length})
        </h2>
        {report.needsHumanLeads.length === 0 ? (
          <EmptyState text="No leads flagged for follow-up yet — warm trade/finance and explicit callback requests will show here." />
        ) : (
          <LeadTable rows={report.needsHumanLeads} highlight="warm" />
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Follow-up Activity</h2>
        {noHandoffs ? (
          <EmptyState text="No follow-up items created yet — DLR creates them automatically when a reply needs personal attention." />
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 text-sm text-gray-700">
            <p>
              <span className="font-semibold">{report.handoffsCreated}</span>{' '}
              {report.handoffsCreated === 1 ? 'follow-up item has' : 'follow-up items have'} been created.{' '}
              <span className="font-semibold">{report.handoffsResolved}</span> resolved.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              DLR tracks these items automatically as conversations progress.
            </p>
          </div>
        )}
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <p className="text-xs text-gray-400 pt-4">
        Report generated {fmtDateTime(report.generatedAt)}.
      </p>
    </div>
  )
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
}: { label: string; value: number | string; color?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-100 px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold ${color ?? 'text-gray-800'}`}>{value}</p>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="bg-white rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-400 text-center">
      {text}
    </div>
  )
}

function LeadTable({
  rows,
  highlight,
}: {
  rows: Array<{
    leadId: string
    firstName: string
    lastName: string
    phone: string
    vehicleOfInterest: string | null
    replyClassification: string | null
    replyBody: string | null
    lastReplyAt: string | null
    sendStatus: string
    handoffStatus: string | null
  }>
  highlight: 'hot' | 'warm'
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
          <tr>
            <th className="px-4 py-2 text-left">Lead</th>
            <th className="px-4 py-2 text-left">Vehicle</th>
            <th className="px-4 py-2 text-left">Reply</th>
            <th className="px-4 py-2 text-left">Classification</th>
            <th className="px-4 py-2 text-left">Last reply</th>
            <th className="px-4 py-2 text-left">Handoff</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(r => (
            <tr key={r.leadId}>
              <td className="px-4 py-2">
                <p className="font-semibold text-gray-800">{r.firstName} {r.lastName}</p>
                <p className="text-xs text-gray-500 font-mono">{r.phone}</p>
              </td>
              <td className="px-4 py-2 text-xs text-gray-600">{r.vehicleOfInterest ?? '—'}</td>
              <td className="px-4 py-2 text-xs text-gray-700 max-w-xs">
                <span className="line-clamp-2">{r.replyBody ?? '—'}</span>
              </td>
              <td className="px-4 py-2">
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                  highlight === 'hot' ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {r.replyClassification ?? '—'}
                </span>
              </td>
              <td className="px-4 py-2 text-xs text-gray-600">{r.lastReplyAt ? new Date(r.lastReplyAt).toLocaleString() : '—'}</td>
              <td className="px-4 py-2 text-xs text-gray-600">{r.handoffStatus ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
