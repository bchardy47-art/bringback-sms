import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { authOptions } from '@/lib/auth'
import { getAutomationHealth, getHandoffQueue, pauseTenantAutomation, resumeTenantAutomation } from '@/lib/admin/dlr-queries'
import { LaunchReadinessChecklist } from '@/components/admin/LaunchReadinessChecklist'

const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700',
  high:   'bg-orange-100 text-orange-700',
  normal: 'bg-blue-100 text-blue-700',
}


export default async function DlrOverviewPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const [health, openTasks] = await Promise.all([
    getAutomationHealth(session.user.tenantId),
    getHandoffQueue(session.user.tenantId, { status: 'open', limit: 5 }),
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

  if (!health) return <div className="p-8 text-gray-500">Tenant not found.</div>

  const smsLive     = health.smsLiveMode
  const tenantOk    = !health.tenant.automationPaused
  const automationOk = smsLive && tenantOk

  return (
    <div className="px-8 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">DLR Control Center</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Dead Lead Revival — pipeline visibility and admin controls
        </p>
      </div>

      {/* Launch readiness checklist — top of page so it's always visible */}
      <LaunchReadinessChecklist tenantId={health.tenant.id} />

      {/* Status banner */}
      {!automationOk && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />
          <span className="text-sm font-semibold text-red-700">
            Automation is {!smsLive ? 'blocked (SMS_LIVE_MODE not set)' : 'paused by admin'}.
            No messages will be sent.
          </span>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Active Enrollments"  value={health.activeEnrollments}  />
        <StatCard label="Open Handoff Tasks"  value={health.openHandoffTasks}
          alert={health.urgentHandoffTasks > 0}
          sub={health.urgentHandoffTasks > 0 ? `${health.urgentHandoffTasks} urgent` : undefined}
        />
        <StatCard label="Sent (24h)"    value={health.messagesLast24h.sent}    />
        <StatCard label="Skipped (24h)" value={health.messagesLast24h.skipped}
          alert={health.messagesLast24h.skipped > 0}
        />
      </div>

      {/* Health grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Automation status */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Automation Status</h2>
          <div className="space-y-2">
            <StatusRow label="SMS_LIVE_MODE" ok={smsLive}  yes="live"   no="off — sends blocked" />
            <StatusRow label="DRY_RUN"       ok={!health.dryRun} yes="off" no="on — sends suppressed" />
            <StatusRow label="Tenant automation" ok={tenantOk} yes="running" no="paused by admin" />
          </div>
          <div className="mt-4 flex gap-2">
            {tenantOk ? (
              <form action={pause}>
                <button
                  type="submit"
                  className="px-3 py-1.5 text-xs font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                >
                  Pause automation
                </button>
              </form>
            ) : (
              <form action={resume}>
                <button
                  type="submit"
                  className="px-3 py-1.5 text-xs font-semibold text-green-600 border border-green-200 rounded-lg hover:bg-green-50 transition-colors"
                >
                  Resume automation
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Skip reason breakdown */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Skip Reasons (24h)
          </h2>
          {Object.keys(health.skipReasonBreakdown).length === 0 ? (
            <p className="text-sm text-gray-400">No skipped sends in last 24 hours.</p>
          ) : (
            <div className="space-y-1.5">
              {Object.entries(health.skipReasonBreakdown)
                .sort(([, a], [, b]) => b - a)
                .map(([reason, count]) => (
                  <div key={reason} className="flex items-center justify-between">
                    <span className="text-xs font-mono text-gray-600">{reason}</span>
                    <span className="text-xs font-bold text-gray-900">{count}</span>
                  </div>
                ))}
            </div>
          )}
          <Link href="/admin/dlr/suppression" className="mt-3 block text-xs text-red-600 hover:underline">
            Full suppression report →
          </Link>
        </div>
      </div>

      {/* Top urgent handoffs */}
      {openTasks.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Needs Attention</h2>
            <Link href="/admin/dlr/handoffs" className="text-xs text-red-600 hover:underline">
              View all →
            </Link>
          </div>
          <table className="w-full">
            <tbody>
              {openTasks.map((task) => (
                <tr key={task.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3">
                    <Link
                      href={`/admin/dlr/leads/${task.lead.id}`}
                      className="text-sm font-semibold text-gray-900 hover:text-red-600"
                    >
                      {task.lead.firstName} {task.lead.lastName}
                    </Link>
                    <p className="text-xs text-gray-400 font-mono">{task.lead.phone}</p>
                  </td>
                  <td className="px-5 py-3 max-w-[220px]">
                    <p className="text-xs text-gray-600 truncate">"{task.customerMessage}"</p>
                    <p className="text-xs text-gray-400 mt-0.5">{task.recommendedNextAction}</p>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${PRIORITY_COLOR[task.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                      {task.priority}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/admin/dlr/leads/${task.lead.id}`}
                      className="text-xs font-semibold text-red-600 hover:text-red-700"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatCard({
  label, value, alert, sub,
}: {
  label: string
  value: number
  alert?: boolean
  sub?: string
}) {
  return (
    <div className={`bg-white rounded-xl border p-5 ${alert ? 'border-red-200' : 'border-gray-200'}`}>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${alert ? 'text-red-600' : 'text-gray-900'}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-red-500 mt-0.5">{sub}</p>}
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
