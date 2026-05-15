/**
 * Phase 13 — Live Pilot Execution
 * /admin/dlr/live-pilot
 *
 * The operational command center for the first live SMS pilot.
 * Shows every first-pilot batch with its full execution status.
 *
 * "The goal is not speed. The goal is to make the first live run
 *  controlled, observable, reversible, and reviewable."
 */

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { NoLiveSMSBanner } from '@/components/admin/NoLiveSMSBanner'
import { pilotBatches } from '@/lib/db/schema'
import { getLivePilotStatus, type LivePilotStatus } from '@/lib/pilot/live-pilot-execution'
import { ConfirmationGate } from './ConfirmationGate'
import type { FirstPilotState, PilotReport } from '@/lib/db/schema'

// ── State display ─────────────────────────────────────────────────────────────

const STATE_LABEL: Record<FirstPilotState, string> = {
  not_started:          'Not started',
  ready_for_smoke_test: 'Ready for smoke test',
  smoke_test_sending:   'Smoke test in progress…',
  smoke_test_passed:    'Smoke test passed ✓',
  smoke_test_failed:    'Smoke test failed ✗',
  ready_for_remaining:  'Ready for remaining sends',
  remaining_sending:    'Sending remaining leads…',
  completed:            'Completed ✓',
  paused:               'PAUSED',
  cancelled:            'Cancelled',
}

const STATE_STYLE: Record<FirstPilotState, string> = {
  not_started:          'bg-gray-100 text-gray-600',
  ready_for_smoke_test: 'bg-blue-100 text-blue-700',
  smoke_test_sending:   'bg-amber-100 text-amber-700',
  smoke_test_passed:    'bg-emerald-100 text-emerald-700',
  smoke_test_failed:    'bg-red-100 text-red-700',
  ready_for_remaining:  'bg-blue-100 text-blue-700',
  remaining_sending:    'bg-amber-100 text-amber-700',
  completed:            'bg-emerald-100 text-emerald-700',
  paused:               'bg-orange-100 text-orange-700',
  cancelled:            'bg-gray-100 text-gray-500',
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, color = 'gray' }: { label: string; value: number | string; color?: string }) {
  const textColor =
    color === 'green'  ? 'text-emerald-600' :
    color === 'red'    ? 'text-red-600'     :
    color === 'amber'  ? 'text-amber-600'   :
    color === 'blue'   ? 'text-blue-600'    :
    'text-gray-900'

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-center">
      <p className={`text-xl font-bold ${textColor}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

// ── Next action panel ─────────────────────────────────────────────────────────

function NextActionPanel({ status, batchId }: { status: LivePilotStatus; batchId: string }) {
  const state = status.firstPilotState

  if (state === 'completed') {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
        <p className="font-semibold text-emerald-800 text-sm">✓ Pilot completed</p>
        <p className="text-xs text-emerald-700 mt-1">
          Generate the final pilot report below, then review results before expanding.
        </p>
      </div>
    )
  }

  if (state === 'paused' || state === 'cancelled') {
    return (
      <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
        <p className="font-semibold text-orange-800 text-sm">
          {state === 'paused' ? '⏸ Pilot is paused' : '✗ Pilot cancelled'}
        </p>
        <p className="text-xs text-orange-700 mt-1">
          {state === 'paused'
            ? 'No further sends will occur. Use the API to resume or cancel.'
            : 'Generate the pilot report to review what happened.'}
        </p>
      </div>
    )
  }

  if (status.goNoGoBlocked) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
        <p className="font-semibold text-red-800 text-sm">
          🚫 {status.goNoGoBlockerCount} Go/No-Go blocker{status.goNoGoBlockerCount !== 1 ? 's' : ''} — cannot proceed
        </p>
        <p className="text-xs text-red-700 mt-1">
          Resolve all blockers in the{' '}
          <a href="/admin/dlr/go-no-go" className="underline">Go / No-Go report</a>{' '}
          before confirming.
        </p>
      </div>
    )
  }

  if (status.continuationRequired) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
        <p className="font-semibold text-red-800 text-sm">⚠ Continuation confirmation required</p>
        <p className="text-xs text-red-700 mt-1">
          {status.continuationReason ?? 'An issue was detected during the pilot. Review and confirm to continue.'}
        </p>
        <form
          action={`/api/admin/live-pilot/${batchId}`}
          method="POST"
          className="mt-3"
        >
          <input type="hidden" name="action" value="confirm_continue" />
          <button
            type="submit"
            className="px-4 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700"
          >
            I understand — confirm continuation
          </button>
        </form>
      </div>
    )
  }

  const nextAction = status.nextAction ?? 'No action required'
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
      <p className="font-semibold text-blue-800 text-sm">→ Next: {nextAction}</p>
    </div>
  )
}

// ── Emergency controls ────────────────────────────────────────────────────────

function EmergencyControls({ batchId, state }: { batchId: string; state: FirstPilotState }) {
  if (state === 'completed' || state === 'cancelled') return null

  return (
    <div className="rounded-lg border-2 border-red-200 bg-red-50 px-4 py-4 space-y-3">
      <p className="text-xs font-bold text-red-800 uppercase tracking-wide">Emergency Controls</p>
      <p className="text-xs text-red-700">
        These actions take effect immediately. Pausing stops future job scheduling;
        cancelling is permanent. Use these if you see unexpected behavior.
      </p>
      <div className="flex gap-3">
        <form action={`/api/admin/live-pilot/${batchId}`} method="POST">
          <input type="hidden" name="action" value="pause" />
          <button
            type="submit"
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-lg"
          >
            ⏸ Pause Pilot
          </button>
        </form>
        <form action={`/api/admin/live-pilot/${batchId}`} method="POST">
          <input type="hidden" name="action" value="cancel" />
          <button
            type="submit"
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg"
          >
            ✗ Cancel Pilot
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Pilot report panel ────────────────────────────────────────────────────────

function PilotReportPanel({ report }: { report: PilotReport }) {
  const RECO_STYLE = {
    expand:     'bg-emerald-50 border-emerald-200 text-emerald-800',
    repeat:     'bg-blue-50 border-blue-200 text-blue-800',
    pause:      'bg-amber-50 border-amber-200 text-amber-800',
    fix_issues: 'bg-red-50 border-red-200 text-red-800',
  }
  const RECO_ICON = { expand: '✅', repeat: '🔁', pause: '⏸', fix_issues: '🔧' }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">Pilot Report</h3>
        <p className="text-xs text-gray-500 mt-0.5">Generated {new Date(report.generatedAt).toLocaleString()}</p>
      </div>

      {/* Recommendation */}
      <div className={`px-4 py-3 border-b border-gray-200 rounded-none border ${RECO_STYLE[report.recommendation]}`}>
        <p className="text-sm font-bold">
          {RECO_ICON[report.recommendation]}{' '}
          Recommendation:{' '}
          {report.recommendation === 'expand'     ? 'Expand pilot' :
           report.recommendation === 'repeat'     ? 'Repeat with adjustments' :
           report.recommendation === 'pause'      ? 'Pause and review' :
           'Fix issues before retrying'}
        </p>
        <p className="text-xs mt-1 opacity-80">{report.recommendationReason}</p>
      </div>

      {/* Count grid */}
      <div className="grid grid-cols-4 divide-x divide-gray-100 border-b border-gray-200">
        {[
          { label: 'Sent',      value: report.sentCount },
          { label: 'Skipped',   value: report.skippedCount },
          { label: 'Replies',   value: report.replyCount },
          { label: 'Opt-outs',  value: report.optOutCount },
          { label: 'Handoffs',  value: report.handoffCount },
          { label: 'Complaints',value: report.complaintCount },
          { label: 'Failed',    value: report.failedCount },
          { label: 'Leads',     value: report.totalLeads },
        ].map(s => (
          <div key={s.label} className="px-3 py-2 text-center">
            <p className="text-base font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Per-lead results */}
      <div className="divide-y divide-gray-100">
        {report.leads.map(lead => (
          <div key={lead.leadId} className="px-4 py-3 flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs font-semibold text-gray-800">{lead.firstName} {lead.lastName}</p>
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                  lead.sendStatus === 'sent'     ? 'bg-emerald-100 text-emerald-700' :
                  lead.sendStatus === 'skipped'  ? 'bg-amber-100 text-amber-700'    :
                  lead.sendStatus === 'cancelled' ? 'bg-red-100 text-red-700'        :
                  'bg-gray-100 text-gray-600'
                }`}>{lead.sendStatus}</span>
                {lead.optedOut && <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">OPTED OUT</span>}
                {lead.complaint && <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">COMPLAINT</span>}
                {lead.handoffTaskId && <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">HANDOFF</span>}
              </div>
              {lead.skipReason && <p className="text-xs text-gray-500 mt-0.5">Skip reason: {lead.skipReason}</p>}
              {lead.replyClassification && <p className="text-xs text-gray-500 mt-0.5">Reply: {lead.replyClassification} — "{lead.replyBody?.slice(0, 60)}"</p>}
            </div>
            <p className="text-xs text-gray-400 flex-shrink-0">{lead.phone}</p>
          </div>
        ))}
      </div>

      {/* Timeline */}
      {report.timeline.length > 0 && (
        <div className="border-t border-gray-200 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-gray-700">Event Timeline</p>
          <div className="space-y-1.5">
            {report.timeline.map((event, i) => (
              <div key={i} className="flex items-start gap-3 text-xs">
                <span className="text-gray-400 font-mono flex-shrink-0 w-20">
                  {new Date(event.at).toLocaleTimeString()}
                </span>
                <span className={`font-medium flex-shrink-0 ${
                  event.type === 'opt_out' || event.type === 'complaint' || event.type === 'failed' ? 'text-red-600' :
                  event.type === 'smoke_test_passed' ? 'text-emerald-600' :
                  event.type === 'handoff' ? 'text-blue-600' :
                  'text-gray-600'
                }`}>{event.type}</span>
                <span className="text-gray-600">{event.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Batch card ────────────────────────────────────────────────────────────────

async function BatchCard({ batchId }: { batchId: string }) {
  const status = await getLivePilotStatus(batchId)
  if (!status) return null

  const state = status.firstPilotState

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {status.tenantName ?? 'Unknown tenant'} — {status.workflowName ?? 'Unknown workflow'}
          </h2>
          <p className="text-xs text-gray-500">Batch {batchId.slice(0, 8)}…</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATE_STYLE[state]}`}>
            {STATE_LABEL[state]}
          </span>
          {status.confirmed && (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">
              ✓ Confirmed
            </span>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        <StatCard label="Leads"      value={status.leads.length}     color="blue"  />
        <StatCard label="Sent"       value={status.sentCount}         color="green" />
        <StatCard label="Skipped"    value={status.skippedCount}      color="amber" />
        <StatCard label="Failed"     value={status.failedCount}       color="red"   />
        <StatCard label="Replies"    value={status.replyCount}        color="blue"  />
        <StatCard label="Opt-outs"   value={status.optOutCount}       color="red"   />
        <StatCard label="Complaints" value={status.complaintCount}    color="red"   />
        <StatCard label="Handoffs"   value={status.handoffCount}      color="blue"  />
      </div>

      {/* Next action */}
      <NextActionPanel status={status} batchId={batchId} />

      {/* Confirmation gate — only when not yet confirmed and state allows it */}
      {!status.confirmed && state !== 'completed' && state !== 'cancelled' && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">Step 1 — Final Confirmation Gate</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Complete all items below before the smoke test is unlocked.
            </p>
          </div>
          <div className="px-4 py-4">
            <ConfirmationGate batchId={batchId} />
          </div>
        </div>
      )}

      {/* Smoke test panel */}
      {status.confirmed && (state === 'ready_for_smoke_test' || state === 'smoke_test_sending' || state === 'smoke_test_failed') && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">Step 2 — Smoke Test (1 lead)</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Sends one lead only. Verify the message arrived and provider ID is stored before continuing.
            </p>
          </div>
          <div className="px-4 py-4 space-y-3">
            {state === 'ready_for_smoke_test' && (
              <form action={`/api/admin/live-pilot/${batchId}`} method="POST">
                <input type="hidden" name="action" value="start_smoke" />
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg"
                >
                  Start Smoke Test →
                </button>
              </form>
            )}
            {state === 'smoke_test_sending' && (
              <div className="space-y-3">
                <p className="text-sm text-amber-700">Smoke test in progress — verify the message arrived, then click below.</p>
                <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs space-y-1">
                  <p className="font-semibold text-amber-800">Verify before continuing:</p>
                  <p>• Message arrived on the smoke-test lead's phone</p>
                  <p>• Check the Message Audit page for the outbound row</p>
                  <p>• Confirm provider message ID is stored (non-null)</p>
                  <p>• Test inbound reply if possible</p>
                </div>
                <form action={`/api/admin/live-pilot/${batchId}`} method="POST">
                  <input type="hidden" name="action" value="verify_smoke" />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg"
                  >
                    ✓ Smoke Test Verified — Unlock Remaining
                  </button>
                </form>
              </div>
            )}
            {state === 'smoke_test_failed' && (
              <div className="text-sm text-red-700 space-y-1">
                <p>Smoke test failed: {status.smokeTestFailReason ?? 'unknown reason'}</p>
                <p>Fix the underlying issue and retry via the pilot batch page.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Remaining sends panel */}
      {(state === 'smoke_test_passed' || state === 'ready_for_remaining') && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-emerald-50 px-4 py-3 border-b border-emerald-200">
            <h3 className="text-sm font-semibold text-gray-900">Step 3 — Send Remaining Leads</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Smoke test passed. You may now enroll the remaining leads.
            </p>
          </div>
          <div className="px-4 py-4">
            <form action={`/api/admin/live-pilot/${batchId}`} method="POST">
              <input type="hidden" name="action" value="start_remaining" />
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg"
              >
                Send Remaining {status.leads.length - 1} Lead{status.leads.length !== 2 ? 's' : ''} →
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Pilot report */}
      {(state === 'completed' || state === 'cancelled' || state === 'paused') && (
        <div className="space-y-3">
          {status.reportGenerated ? null : (
            <form action={`/api/admin/live-pilot/${batchId}`} method="POST">
              <input type="hidden" name="action" value="generate_report" />
              <button
                type="submit"
                className="px-4 py-2 bg-gray-700 hover:bg-gray-800 text-white text-sm font-semibold rounded-lg"
              >
                Generate Pilot Report
              </button>
            </form>
          )}
        </div>
      )}

      {/* Emergency controls */}
      <EmergencyControls batchId={batchId} state={state} />

      {/* Leads table */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">Leads ({status.leads.length})</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {status.leads.map(lead => (
            <div key={lead.leadId} className="px-4 py-3 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs font-semibold text-gray-800">{lead.firstName} {lead.lastName}</p>
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                    lead.sendStatus === 'sent'    ? 'bg-emerald-100 text-emerald-700' :
                    lead.sendStatus === 'skipped' ? 'bg-amber-100 text-amber-700'    :
                    'bg-gray-100 text-gray-600'
                  }`}>{lead.sendStatus}</span>
                  {lead.isSmokeTestLead && (
                    <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                      Smoke test lead
                    </span>
                  )}
                  {lead.replyClassification && (
                    <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                      {lead.replyClassification}
                    </span>
                  )}
                </div>
                {lead.eligibilityResult && !lead.eligibilityResult.eligible && (
                  <p className="text-xs text-red-600 mt-0.5">Ineligible: {lead.eligibilityResult.reason}</p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                {lead.previewMessages && lead.previewMessages.length > 0 && (
                  <p className="text-xs text-gray-400">{lead.previewMessages.length} message{lead.previewMessages.length !== 1 ? 's' : ''} queued</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function LivePilotPage() {
  const firstPilotBatches = await db.query.pilotBatches.findMany({
    where: eq(pilotBatches.isFirstPilot, true),
    with: { tenant: true, workflow: true },
    orderBy: (b, { desc }) => [desc(b.createdAt)],
  })

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Live Pilot Execution</h1>
        <p className="mt-1 text-sm text-gray-500">
          Controlled 5-lead first pilot. Complete the confirmation gate, run one smoke test,
          verify it, then unlock the remaining leads. Monitor everything here.
        </p>
      </div>

      {/* Waiting banner — shown whenever no batch is actively sending */}
      {(firstPilotBatches.length === 0 || firstPilotBatches.every(b => b.firstPilotState === 'not_started' || b.firstPilotState === 'draft' as unknown)) && (
        <NoLiveSMSBanner reason="No first-pilot batch is currently sending — 10DLC must be approved and the confirmation gate passed before the smoke test can begin" />
      )}

      {firstPilotBatches.length === 0 && (
        <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl space-y-3">
          <p className="text-gray-600 text-sm font-semibold">No first-pilot batches yet</p>
          <p className="text-gray-400 text-xs max-w-sm mx-auto">
            Import your pilot leads, review the Pilot Pack, then create a draft batch.
            This page will show the live execution state once a batch is approved and the smoke test begins.
          </p>
          <div className="flex items-center justify-center gap-4 pt-1">
            <a href="/admin/dlr/pilot-leads" className="text-xs font-semibold text-blue-600 hover:underline">Import leads →</a>
            <a href="/admin/dlr/pilot-pack"  className="text-xs font-semibold text-blue-600 hover:underline">Open Pilot Pack →</a>
          </div>
        </div>
      )}

      {/* Per-batch execution panel */}
      {firstPilotBatches.map(batch => (
        <div key={batch.id} className="border-2 border-gray-200 rounded-xl p-6 space-y-5">
          <BatchCard batchId={batch.id} />
        </div>
      ))}

      {/* Reference links */}
      <div className="rounded-lg bg-gray-50 border border-gray-200 px-5 py-4 text-xs text-gray-500 space-y-1">
        <p className="font-semibold text-gray-700">Related pages:</p>
        <p>
          <a href="/admin/dlr/go-no-go" className="text-blue-600 underline">Go / No-Go Report</a>{' — '}
          <a href="/admin/dlr/production" className="text-blue-600 underline">Production Config</a>{' — '}
          <a href="/admin/dlr/messages" className="text-blue-600 underline">Message Audit</a>{' — '}
          <a href="/admin/dlr/handoffs" className="text-blue-600 underline">Handoff Queue</a>{' — '}
          <a href="/admin/dlr/suppression" className="text-blue-600 underline">Suppression</a>
        </p>
      </div>
    </div>
  )
}
