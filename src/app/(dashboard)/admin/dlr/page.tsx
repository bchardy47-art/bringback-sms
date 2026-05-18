/**
 * DLR Platform Admin — control center landing page.
 *
 * This is what a platform admin (BCHardy / DLR ops) sees as their first
 * surface after logging in. It is intentionally cross-tenant:
 *
 *   - Hero stats: dealership / intake / 10DLC / number / pilot / handoff counts
 *     aggregated across the whole platform.
 *   - Today's Admin Tasks: actionable items derived from the same counts.
 *   - Dealer Setup Pipeline: one row per dealer intake with launch status,
 *     10DLC status, number status, tenant link, and next action.
 *   - Urgent Handoffs: cross-tenant, each row labelled with the dealership.
 *   - Platform Activity: the old single-tenant operational metrics, kept
 *     for ops use but moved below the platform-level content and clearly
 *     labelled as "this tenant" so it can't be mistaken for platform state.
 *
 * Read-only data path. No mutations (the pause/resume actions remain for
 * the admin's own tenant, identical to the prior implementation).
 */

import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { authOptions } from '@/lib/auth'
import {
  getAutomationHealth,
  pauseTenantAutomation,
  resumeTenantAutomation,
} from '@/lib/admin/dlr-queries'
import { getPlatformOverview, type PipelineRow } from '@/lib/admin/platform-queries'
import { getLaunchStatusLabel, getLaunchStatusColor } from '@/lib/intake/checklist'

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DlrPlatformAdminPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const [overview, health] = await Promise.all([
    getPlatformOverview(),
    // health is still the admin's own tenant — used by the (de-emphasised)
    // Platform Activity panel below. Don't surface it as platform state.
    getAutomationHealth(session.user.tenantId),
  ])

  async function pause() {
    'use server'
    await pauseTenantAutomation(session!.user.tenantId)
    revalidatePath('/admin/dlr')
  }
  async function resume() {
    'use server'
    await resumeTenantAutomation(session!.user.tenantId)
    revalidatePath('/admin/dlr')
  }

  const { stats, pipeline, urgentHandoffs } = overview
  const tasks = buildAdminTasks(stats, pipeline, urgentHandoffs.length)

  return (
    <div className="px-4 md:px-8 py-6 space-y-6 max-w-7xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          BCHardy LLC · Platform Operations
        </p>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">
          DLR Platform Admin
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Platform Control Center — dealerships, onboarding, 10DLC, numbers, and pilots.
        </p>
      </div>

      {/* ── Hero stats (platform level) ─────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <PlatformStatCard
          label="Active Dealerships"
          value={stats.activeDealerships}
          href="/admin/dlr/intakes"
        />
        <PlatformStatCard
          label="Intakes Needing Action"
          value={stats.intakesNeedingAction}
          href="/admin/dlr/intakes"
          alert={stats.intakesNeedingAction > 0}
        />
        <PlatformStatCard
          label="10DLC Pending"
          value={stats.tenDlcPending}
          href="/admin/dlr/intakes"
          alert={stats.tenDlcPending > 0}
        />
        <PlatformStatCard
          label="Numbers Unassigned"
          value={stats.numbersNeedingAssign}
          href="/admin/dlr/intakes"
          alert={stats.numbersNeedingAssign > 0}
        />
        <PlatformStatCard
          label="Pilot Batches to Review"
          value={stats.pilotBatchesToReview}
          href="/admin/dlr/pilot"
          alert={stats.pilotBatchesToReview > 0}
        />
        <PlatformStatCard
          label="Open Handoffs"
          value={stats.openHandoffsAll}
          href="/admin/dlr/handoffs"
          sub={stats.urgentHandoffsAll > 0 ? `${stats.urgentHandoffsAll} urgent` : undefined}
          alert={stats.urgentHandoffsAll > 0}
        />
      </div>

      {/* ── Today's Admin Tasks ─────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Today&apos;s Admin Tasks</h2>
        {tasks.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-400 text-center">
            Nothing to do — every dealership is current. 🎉
          </div>
        ) : (
          <ul className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {tasks.map(t => (
              <li key={t.key} className="px-5 py-3 flex items-center gap-4">
                <span className={`inline-flex w-2 h-2 rounded-full flex-shrink-0 ${
                  t.priority === 'urgent' ? 'bg-red-500' :
                  t.priority === 'high'   ? 'bg-orange-500' :
                                            'bg-blue-500'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{t.label}</p>
                  {t.detail && <p className="text-xs text-gray-500 mt-0.5">{t.detail}</p>}
                </div>
                <Link
                  href={t.href}
                  className="text-xs font-semibold text-red-600 hover:text-red-700 flex-shrink-0"
                >
                  Go →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Dealer Setup Pipeline ───────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Dealer Setup Pipeline</h2>
          <Link href="/admin/dlr/intakes" className="text-xs text-red-600 hover:underline">
            All intakes →
          </Link>
        </div>
        {pipeline.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-400 text-center">
            No dealer intakes yet — generate the first one from{' '}
            <Link href="/admin/dlr/intakes" className="text-red-600 hover:underline">Intakes</Link>.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/*
              Each pipeline row is a Next.js <Link>. Mobile renders a
              labelled stacked card; desktop renders the same 6-column
              grid that was already working. Header row is hidden on
              mobile (would be unlabelled / mis-aligned next to the
              stacked card content).
            */}
            <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1.5fr_2fr] gap-4 px-5 py-3 bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
              <div>Dealership</div>
              <div>Launch</div>
              <div>10DLC</div>
              <div>Number</div>
              <div>Tenant</div>
              <div>Next action</div>
            </div>
            <div className="divide-y divide-gray-100">
              {pipeline.map(row => (
                <Link
                  key={row.intakeId}
                  href={row.nextActionHref}
                  className="block hover:bg-gray-50 hover:shadow-sm cursor-pointer transition-all"
                >
                  {/* ── Mobile card (hidden on md+) ── */}
                  <div className="md:hidden px-4 py-3">
                    <p className="font-semibold text-gray-900">{row.dealershipName}</p>
                    <p className="text-xs text-gray-400">
                      {row.submittedAt
                        ? `Submitted ${new Date(row.submittedAt).toLocaleDateString()}`
                        : 'Form not yet submitted'}
                    </p>
                    <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 mt-3 text-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-gray-400 flex-shrink-0">Launch:</span>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold truncate ${getLaunchStatusColor(row.launchStatus)}`}>
                          {getLaunchStatusLabel(row.launchStatus)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-gray-400 flex-shrink-0">10DLC:</span>
                        <span className="font-mono text-gray-600 truncate">{row.tenDlcStatus}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-400 flex-shrink-0">Number:</span>
                        {row.numberAssigned ? (
                          <span className="font-semibold text-emerald-700">✓ assigned</span>
                        ) : row.tenantId ? (
                          <span className="font-semibold text-amber-700">— missing</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-gray-400 flex-shrink-0">Tenant:</span>
                        {row.tenantId
                          ? <span className="text-emerald-700 font-semibold truncate">✓ {row.tenantName}</span>
                          : <span className="text-gray-300">not provisioned</span>}
                      </div>
                    </div>
                    <div className="mt-3 text-right text-sm">
                      <span className="font-semibold text-red-600">{row.nextAction}</span>
                      <span className="text-red-600 ml-1" aria-hidden="true">→</span>
                    </div>
                  </div>

                  {/* ── Desktop grid (md+) ── */}
                  <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1.5fr_2fr] gap-4 items-center px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{row.dealershipName}</p>
                      <p className="text-xs text-gray-400">
                        {row.submittedAt
                          ? `Submitted ${new Date(row.submittedAt).toLocaleDateString()}`
                          : 'Form not yet submitted'}
                      </p>
                    </div>
                    <div>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${getLaunchStatusColor(row.launchStatus)}`}>
                        {getLaunchStatusLabel(row.launchStatus)}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 font-mono truncate">
                      {row.tenDlcStatus}
                    </div>
                    <div>
                      {row.numberAssigned ? (
                        <span className="text-xs font-semibold text-emerald-700">✓ assigned</span>
                      ) : row.tenantId ? (
                        <span className="text-xs font-semibold text-amber-700">— missing</span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </div>
                    <div className="text-xs min-w-0">
                      {row.tenantId
                        ? <span className="text-emerald-700 font-semibold truncate block">✓ {row.tenantName}</span>
                        : <span className="text-gray-300">not provisioned</span>}
                    </div>
                    <div className="text-xs text-right">
                      <span className="font-semibold text-red-600">{row.nextAction}</span>
                      <span className="text-red-600 ml-1" aria-hidden="true">→</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Urgent Handoffs (cross-tenant) ──────────────────────────────── */}
      {urgentHandoffs.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Urgent Handoffs</h2>
            <Link href="/admin/dlr/handoffs" className="text-xs text-red-600 hover:underline">
              All handoffs →
            </Link>
          </div>
          <div className="bg-white rounded-xl border border-red-200 overflow-hidden">
            {/* ── Mobile card list (hidden on md+) ── */}
            <ul className="md:hidden divide-y divide-gray-100">
              {urgentHandoffs.map(h => (
                <li key={h.id} className="px-4 py-3">
                  <p className="font-semibold text-gray-900">{h.tenantName}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Lead: <span className="text-gray-700">{h.leadFirstName} {h.leadLastName}</span>
                  </p>
                  <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                    &ldquo;{h.customerMessage}&rdquo;
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-xs font-mono text-gray-500 truncate">{h.classification}</span>
                    <Link href="/admin/dlr/handoffs" className="text-xs font-semibold text-red-600 hover:text-red-700 flex-shrink-0">
                      Review →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>

            {/* ── Desktop table (md+) ── */}
            <table className="hidden md:table w-full text-sm">
              <thead className="bg-red-50 text-xs text-red-600 uppercase tracking-wider text-left">
                <tr>
                  <th className="px-5 py-3">Dealership</th>
                  <th className="px-5 py-3">Lead</th>
                  <th className="px-5 py-3">Message</th>
                  <th className="px-5 py-3">Classification</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {urgentHandoffs.map(h => (
                  <tr key={h.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-semibold text-gray-900">{h.tenantName}</td>
                    <td className="px-5 py-3 text-gray-700">{h.leadFirstName} {h.leadLastName}</td>
                    <td className="px-5 py-3 text-xs text-gray-600 max-w-xs truncate">
                      &ldquo;{h.customerMessage}&rdquo;
                    </td>
                    <td className="px-5 py-3 text-xs font-mono text-gray-500">{h.classification}</td>
                    <td className="px-5 py-3 text-right">
                      <Link href="/admin/dlr/handoffs" className="text-xs font-semibold text-red-600 hover:text-red-700">
                        Review →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── System Health (de-emphasised, scoped to admin's own tenant) ── */}
      {health && (
        <section className="pt-4 border-t border-gray-200">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-gray-700">
              System Health
            </h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">
              Internal sandbox only
            </span>
          </div>
          <p className="text-xs text-gray-500 mb-3 max-w-2xl">
            Internal test activity only. This is not dealership production traffic.
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <SmallStat label="Active Enrollments" value={health.activeEnrollments} />
            <SmallStat label="Sent (24h)"         value={health.messagesLast24h.sent} />
            <SmallStat label="Skipped (24h)"      value={health.messagesLast24h.skipped} alert={health.messagesLast24h.skipped > 0} />
            <SmallStat label="Failed (24h)"       value={health.messagesLast24h.failed}  alert={health.messagesLast24h.failed > 0} />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h3 className="text-xs font-semibold text-gray-700 mb-2">SMS Plumbing</h3>
              <div className="space-y-1.5">
                <StatusRow label="SMS_LIVE_MODE"     ok={health.smsLiveMode}             yes="live"    no="off — sends blocked" />
                <StatusRow label="DRY_RUN"           ok={!health.dryRun}                 yes="off"     no="on — sends suppressed" />
                <StatusRow label="Tenant automation" ok={!health.tenant.automationPaused} yes="running" no="paused" />
              </div>
              <div className="mt-3 flex gap-2">
                {!health.tenant.automationPaused ? (
                  <form action={pause}>
                    <button type="submit" className="px-3 py-1.5 text-xs font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors">
                      Pause BCHardy automation
                    </button>
                  </form>
                ) : (
                  <form action={resume}>
                    <button type="submit" className="px-3 py-1.5 text-xs font-semibold text-green-600 border border-green-200 rounded-lg hover:bg-green-50 transition-colors">
                      Resume BCHardy automation
                    </button>
                  </form>
                )}
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h3 className="text-xs font-semibold text-gray-700 mb-2">Skip Reasons (24h, BCHardy)</h3>
              {Object.keys(health.skipReasonBreakdown).length === 0 ? (
                <p className="text-xs text-gray-400">No skipped sends in the last 24 hours.</p>
              ) : (
                <div className="space-y-1">
                  {Object.entries(health.skipReasonBreakdown)
                    .sort(([, a], [, b]) => b - a)
                    .map(([reason, count]) => (
                      <div key={reason} className="flex items-center justify-between text-xs">
                        <span className="font-mono text-gray-600">{reason}</span>
                        <span className="font-bold text-gray-900">{count}</span>
                      </div>
                    ))}
                </div>
              )}
              <Link href="/admin/dlr/suppression" className="mt-3 block text-xs text-red-600 hover:underline">
                Full suppression report →
              </Link>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function PlatformStatCard({
  label, value, href, alert, sub,
}: {
  label: string
  value: number
  href:  string
  alert?: boolean
  sub?:   string
}) {
  return (
    <Link
      href={href}
      className={`block bg-white rounded-xl border p-3 md:p-4 hover:shadow-sm transition-shadow ${
        alert ? 'border-red-200' : 'border-gray-200'
      }`}
    >
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`text-2xl md:text-3xl font-bold mt-1 ${alert ? 'text-red-600' : 'text-gray-900'}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-red-500 mt-0.5">{sub}</p>}
    </Link>
  )
}

function SmallStat({
  label, value, alert,
}: {
  label: string
  value: number
  alert?: boolean
}) {
  return (
    <div className={`bg-white rounded-xl border p-3 ${alert ? 'border-red-200' : 'border-gray-200'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${alert ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

function StatusRow({ label, ok, yes, no }: { label: string; ok: boolean; yes: string; no: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-600">{label}</span>
      <span className={`flex items-center gap-1.5 text-xs font-semibold ${ok ? 'text-green-600' : 'text-red-600'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
        {ok ? yes : no}
      </span>
    </div>
  )
}

// ── Today's tasks ──────────────────────────────────────────────────────────────

type AdminTask = {
  key:      string
  label:    string
  detail?:  string
  href:     string
  priority: 'urgent' | 'high' | 'normal'
}

function buildAdminTasks(
  stats: {
    intakesNeedingAction:  number
    tenDlcPending:         number
    numbersNeedingAssign:  number
    pilotBatchesToReview:  number
    openHandoffsAll:       number
    urgentHandoffsAll:     number
  },
  pipeline: PipelineRow[],
  _urgentHandoffCount: number,
): AdminTask[] {
  const tasks: AdminTask[] = []

  // Urgent first
  if (stats.urgentHandoffsAll > 0) {
    tasks.push({
      key:      'urgent_handoffs',
      label:    `Resolve ${stats.urgentHandoffsAll} urgent handoff${stats.urgentHandoffsAll === 1 ? '' : 's'}`,
      detail:   'Customer reply classified as complaint or hostile — needs review now.',
      href:     '/admin/dlr/handoffs',
      priority: 'urgent',
    })
  }

  // Per-stage counts derived from the pipeline rows so the count matches
  // exactly what the dealer-setup-pipeline table is showing.
  const submitNeeded = pipeline.filter(r =>
    r.launchStatus === 'submitted' || r.launchStatus === 'info_complete',
  ).length
  if (submitNeeded > 0) {
    tasks.push({
      key:      'submit_10dlc',
      label:    `Submit 10DLC to TCR (${submitNeeded})`,
      detail:   'Intake info complete — ready to submit brand + campaign.',
      href:     '/admin/dlr/intakes',
      priority: 'high',
    })
  }

  const provisionNeeded = pipeline.filter(r =>
    r.launchStatus === '10dlc_approved' && !r.tenantId,
  ).length
  if (provisionNeeded > 0) {
    tasks.push({
      key:      'provision_tenant',
      label:    `Provision tenant from intake (${provisionNeeded})`,
      detail:   '10DLC approved — create the DLR tenant from the intake form.',
      href:     '/admin/dlr/intakes',
      priority: 'high',
    })
  }

  if (stats.numbersNeedingAssign > 0) {
    tasks.push({
      key:      'assign_number',
      label:    `Assign Telnyx number (${stats.numbersNeedingAssign})`,
      detail:   'Provisioned tenants without a sending number — assign in Telnyx, then attach.',
      href:     '/admin/dlr/intakes',
      priority: 'high',
    })
  }

  const workflowApprovalNeeded = pipeline.filter(r =>
    r.tenantId && r.nextAction === 'Approve workflow',
  ).length
  if (workflowApprovalNeeded > 0) {
    tasks.push({
      key:      'approve_workflow',
      label:    `Approve workflow for live (${workflowApprovalNeeded})`,
      detail:   'Tenant ready — workflow copy still needs human sign-off.',
      href:     '/admin/dlr/workflows',
      priority: 'normal',
    })
  }

  if (stats.pilotBatchesToReview > 0) {
    tasks.push({
      key:      'review_pilot',
      label:    `Review pilot batch (${stats.pilotBatchesToReview})`,
      detail:   'Pilot batches in previewed/approved waiting on ops sign-off before send.',
      href:     '/admin/dlr/pilot',
      priority: 'normal',
    })
  }

  // 10DLC pending is informational rather than actionable (carrier turnaround)
  // but useful as a low-priority reminder.
  if (stats.tenDlcPending > 0) {
    tasks.push({
      key:      'tendlc_pending',
      label:    `${stats.tenDlcPending} 10DLC submission${stats.tenDlcPending === 1 ? '' : 's'} awaiting carrier`,
      detail:   'No action required — check Telnyx portal periodically.',
      href:     '/admin/dlr/intakes',
      priority: 'normal',
    })
  }

  return tasks
}
