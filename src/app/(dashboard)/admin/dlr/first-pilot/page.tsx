/**
 * Phase 11 — First Live Pilot Runbook
 * /admin/dlr/first-pilot
 *
 * Shows the exact current state of the first live pilot, with a clear
 * "next required action" for each state, all counts, and emergency controls.
 *
 * "The goal is to make the first live pilot boring, small, observable,
 * and reversible."
 *
 * WAITING STATE: While 10DLC is pending, this page is read-only.
 * No SMS will be sent until: 10DLC approved + batch approved + confirmation gate passed.
 */

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pilotBatches } from '@/lib/db/schema'
import { getFirstPilotStatus, validateFirstPilotReadiness, type FirstPilotStatus } from '@/lib/pilot/first-pilot'
import type { FirstPilotState } from '@/lib/db/schema'
import { NoLiveSMSBanner } from '@/components/admin/NoLiveSMSBanner'

// ── State display helpers ─────────────────────────────────────────────────────

const STATE_LABEL: Record<FirstPilotState, string> = {
  not_started:          'Not started',
  ready_for_smoke_test: 'Ready for smoke test',
  smoke_test_sending:   'Smoke test sending…',
  smoke_test_passed:    'Smoke test passed ✓',
  smoke_test_failed:    'Smoke test failed ✗',
  ready_for_remaining:  'Ready for remaining sends',
  remaining_sending:    'Sending remaining leads…',
  completed:            'Completed ✓',
  paused:               'Paused',
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

function StatCard({ label, value, highlight = false }: { label: string; value: number | string; highlight?: boolean }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 text-center">
      <p className={`text-2xl font-bold ${highlight ? 'text-blue-600' : 'text-gray-900'}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

// ── Runbook steps ─────────────────────────────────────────────────────────────

const RUNBOOK_STEPS = [
  { n:  1, label: 'Telnyx/10DLC approved' },
  { n:  2, label: 'Sending number assigned' },
  { n:  3, label: 'Webhook routes configured' },
  { n:  4, label: 'SMS_LIVE_MODE=true confirmed' },
  { n:  5, label: 'Tenant live readiness passes' },
  { n:  6, label: 'Workflow approved and active' },
  { n:  7, label: 'Pilot batch created (max 5 leads)' },
  { n:  8, label: 'All leads pass eligibility and consent' },
  { n:  9, label: 'Dry-run preview generated' },
  { n: 10, label: 'Message body reviewed (incl. opt-out footer)' },
  { n: 11, label: 'Admin manually approves the batch' },
  { n: 12, label: 'Smoke test: send one lead first' },
  { n: 13, label: 'Verify message audit row created' },
  { n: 14, label: 'Verify Telnyx provider message ID stored' },
  { n: 15, label: 'Verify inbound reply webhook works' },
  { n: 16, label: 'Verify STOP opt-out path works' },
  { n: 17, label: 'Verify pause/cancel controls work' },
  { n: 18, label: 'Send remaining leads after smoke test passes' },
  { n: 19, label: 'Monitor handoff queue' },
  { n: 20, label: 'Review results before expanding' },
]

function getRunbookProgress(status: FirstPilotStatus): number {
  switch (status.firstPilotState) {
    case 'not_started':          return 11 // steps 1–11 must be done to reach "ready"
    case 'ready_for_smoke_test': return 11
    case 'smoke_test_sending':   return 12
    case 'smoke_test_passed':    return 14
    case 'smoke_test_failed':    return 13
    case 'ready_for_remaining':  return 17
    case 'remaining_sending':    return 18
    case 'completed':            return 20
    default:                     return 0
  }
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default async function FirstPilotPage() {
  // Find all first-pilot batches
  const firstPilotBatches = await db.query.pilotBatches.findMany({
    where: eq(pilotBatches.isFirstPilot, true),
    with: { tenant: true, workflow: true },
    orderBy: (b, { desc }) => [desc(b.createdAt)],
  })

  if (firstPilotBatches.length === 0) {
    return (
      <div className="p-8 max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">First Live Pilot</h1>
          <p className="mt-1 text-sm text-gray-500">
            This page becomes active once a first-pilot batch is created and approved.
            While waiting for 10DLC, use this time to complete the steps below.
          </p>
        </div>

        <NoLiveSMSBanner reason="No first-pilot batch exists yet — complete the Pilot Pack steps before returning here" />

        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-3">
          <p className="text-sm font-semibold text-gray-800">What to do while waiting for 10DLC:</p>
          <ol className="space-y-2 text-sm text-gray-600 list-decimal list-inside">
            <li>Import and select pilot leads → <a href="/admin/dlr/pilot-leads" className="text-blue-600 hover:underline">Pilot Leads</a></li>
            <li>Review the dry-run report and readiness score → <a href="/admin/dlr/pilot-pack" className="text-blue-600 hover:underline">Pilot Pack</a></li>
            <li>Download and review the pilot checklist and sample messages</li>
            <li>Confirm all consent documentation is in order</li>
            <li>Make sure the workflow is approved for live sends → <a href="/admin/dlr/workflows" className="text-blue-600 hover:underline">Workflows</a></li>
            <li>Return here once 10DLC is approved to start the smoke test</li>
          </ol>
        </div>

        {/* Runbook */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-900">First Live Pilot Runbook</h2>
            <p className="text-xs text-gray-500 mt-0.5">Complete these steps in order before sending the first live SMS.</p>
          </div>
          <div className="divide-y divide-gray-100">
            {RUNBOOK_STEPS.map(step => (
              <div key={step.n} className="px-4 py-2.5 flex items-center gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-xs font-bold flex items-center justify-center">
                  {step.n}
                </span>
                <span className="text-sm text-gray-700">{step.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Render first pilot panels for each batch
  const panels = await Promise.all(
    firstPilotBatches.map(async batch => {
      const status  = await getFirstPilotStatus(batch.id)
      const { checks } = await validateFirstPilotReadiness(batch.id).catch(() => ({ checks: [] as Awaited<ReturnType<typeof validateFirstPilotReadiness>>['checks'] }))
      return { batch, status, checks }
    })
  )

  // Check if any batch is actually live (sending/completed) — if not, show waiting banner
  const anyLive = panels.some(p =>
    ['smoke_test_sending', 'remaining_sending', 'ready_for_smoke_test', 'ready_for_remaining'].includes(p.status?.firstPilotState ?? '')
  )

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">First Live Pilot</h1>
        <p className="mt-1 text-sm text-gray-500">
          Controlled 5-lead smoke-test workflow. Do not expand to broad automation until this passes.
        </p>
      </div>

      {/* Show waiting banner when no batch is actively sending */}
      {!anyLive && (
        <NoLiveSMSBanner reason="Batch is in draft — complete the confirmation gate and 10DLC approval before the smoke test begins" />
      )}

      {panels.map(({ batch, status, checks }) => {
        if (!status) return null
        const progress = getRunbookProgress(status)
        const state    = status.firstPilotState

        return (
          <div key={batch.id} className="space-y-5">
            {/* Batch header */}
            <div className="flex items-center gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {batch.tenant?.name} — {batch.workflow?.name}
                </h2>
                <p className="text-xs text-gray-500">Batch {batch.id.slice(0, 8)}…</p>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATE_STYLE[state]}`}>
                {STATE_LABEL[state]}
              </span>
            </div>

            {/* Blocker banner */}
            {status.blockers.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-sm font-semibold text-red-800">
                  ✗ {status.blockers.length} blocker{status.blockers.length !== 1 ? 's' : ''} — do not proceed
                </p>
                {status.blockers.map((b, i) => (
                  <p key={i} className="text-xs text-red-700 mt-1">• {b}</p>
                ))}
              </div>
            )}

            {/* Warning banner */}
            {status.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                {status.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-700">⚠ {w}</p>
                ))}
              </div>
            )}

            {/* Next action */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 flex items-center gap-3">
              <span className="text-blue-600 text-lg">→</span>
              <div>
                <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Next required action</p>
                <p className="text-sm text-blue-900 font-medium mt-0.5">{status.nextAction}</p>
              </div>
            </div>

            {/* Counts */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              <StatCard label="Total leads"    value={status.leadCount} />
              <StatCard label="Approved"       value={status.approvedLeadCount} />
              <StatCard label="Sent"           value={status.sentCount} highlight />
              <StatCard label="Skipped/blocked" value={status.skippedCount} />
              <StatCard label="Replies"        value={status.replyCount} />
              <StatCard label="Handoffs"       value={status.handoffCount} />
              <StatCard label="Opt-outs/STOP"  value={status.optOutCount} />
            </div>

            {/* Smoke test detail */}
            {status.smokeTestSentAt && (
              <div className="border border-gray-200 rounded-lg p-4 space-y-2">
                <h3 className="text-sm font-semibold text-gray-900">Smoke Test</h3>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-gray-500">Sent at</p>
                    <p className="text-gray-900">{new Date(status.smokeTestSentAt).toLocaleString()}</p>
                  </div>
                  {status.smokeTestPassedAt && (
                    <div>
                      <p className="text-gray-500">Passed at</p>
                      <p className="text-emerald-700 font-medium">{new Date(status.smokeTestPassedAt).toLocaleString()}</p>
                    </div>
                  )}
                  {status.smokeTestFailedAt && (
                    <div>
                      <p className="text-gray-500">Failed at</p>
                      <p className="text-red-600 font-medium">{new Date(status.smokeTestFailedAt).toLocaleString()}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-gray-500">Audit row verified</p>
                    <p className={status.auditRowVerified ? 'text-emerald-700' : 'text-red-600'}>
                      {status.auditRowVerified ? '✓ Yes' : '✗ No'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Provider ID verified</p>
                    <p className={status.providerIdVerified ? 'text-emerald-700' : 'text-amber-600'}>
                      {status.providerIdVerified ? '✓ Yes' : '⚠ Not confirmed'}
                    </p>
                  </div>
                </div>
                {status.smokeTestFailReason && (
                  <p className="text-xs text-red-600 mt-1">Failure: {status.smokeTestFailReason}</p>
                )}
              </div>
            )}

            {/* Readiness checks */}
            {checks.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
                  <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Pre-Flight Readiness</h3>
                </div>
                <div className="divide-y divide-gray-100">
                  {checks.map(c => (
                    <div key={c.id} className={`px-4 py-2 flex items-start gap-3 ${c.passed ? '' : 'bg-red-50'}`}>
                      <span className={`text-sm font-bold mt-0.5 flex-shrink-0 ${c.passed ? 'text-emerald-600' : 'text-red-500'}`}>
                        {c.passed ? '✓' : '✗'}
                      </span>
                      <div>
                        <p className="text-xs font-medium text-gray-800">{c.label}</p>
                        <p className="text-xs text-gray-500">{c.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Runbook progress */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Runbook Progress</h3>
                <span className="text-xs text-gray-500">{progress}/{RUNBOOK_STEPS.length} steps</span>
              </div>
              <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
                {RUNBOOK_STEPS.map(step => {
                  const done = step.n <= progress
                  return (
                    <div key={step.n} className={`px-4 py-2 flex items-center gap-3 ${done ? '' : 'opacity-50'}`}>
                      <span className={`flex-shrink-0 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center ${
                        done ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'
                      }`}>
                        {done ? '✓' : step.n}
                      </span>
                      <span className="text-xs text-gray-700">{step.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Emergency controls */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Emergency Controls</h3>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/admin/dlr/pilot/${batch.id}`}
                  className="px-3 py-1.5 text-xs font-medium bg-orange-100 text-orange-700 hover:bg-orange-200 rounded-lg"
                >
                  Pause batch
                </a>
                <a
                  href={`/admin/dlr/pilot/${batch.id}`}
                  className="px-3 py-1.5 text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 rounded-lg"
                >
                  Cancel batch
                </a>
                <a
                  href="/admin/dlr/readiness"
                  className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg"
                >
                  Pause tenant (kill switch)
                </a>
                <a
                  href="/admin/dlr/suppression"
                  className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg"
                >
                  Add suppression
                </a>
                <a
                  href="/admin/dlr/handoffs"
                  className="px-3 py-1.5 text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg"
                >
                  Handoff queue →
                </a>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
