import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { getAutomationHealth, pauseTenantAutomation, resumeTenantAutomation } from '@/lib/admin/dlr-queries'

export default async function HealthPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const health = await getAutomationHealth(session.user.tenantId)
  if (!health) return <div className="p-8 text-gray-500">Tenant not found.</div>

  async function pause() {
    'use server'
    await pauseTenantAutomation(session!.user.tenantId)
    revalidatePath('/admin/dlr/health')
    revalidatePath('/admin/dlr')
  }
  async function resume() {
    'use server'
    await resumeTenantAutomation(session!.user.tenantId)
    revalidatePath('/admin/dlr/health')
    revalidatePath('/admin/dlr')
  }

  return (
    <div className="px-8 py-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Automation Health</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Real-time status of the DLR pipeline for {health.tenant.name}
        </p>
      </div>

      {/* Pipeline status */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Pipeline Gates</h2>
        <div className="space-y-3">
          <HealthRow
            label="SMS_LIVE_MODE"
            status={health.smsLiveMode}
            okLabel="Live — messages will be sent"
            failLabel="Off — all sends suppressed"
          />
          <HealthRow
            label="DRY_RUN"
            status={!health.dryRun}
            okLabel="Off — normal operation"
            failLabel="On — sends suppressed"
          />
          <HealthRow
            label="Tenant automation"
            status={!health.tenant.automationPaused}
            okLabel="Running"
            failLabel="Paused by admin"
          />
        </div>
        <div className="pt-2 flex gap-2">
          {health.tenant.automationPaused ? (
            <form action={resume}>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
              >
                Resume automation
              </button>
            </form>
          ) : (
            <form action={pause}>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                Pause automation
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Counts */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <CountCard label="Active workflows"   value={health.activeWorkflows}   sub={`of ${health.totalWorkflows} total`} />
        <CountCard label="Active enrollments" value={health.activeEnrollments} />
        <CountCard label="Paused enrollments" value={health.pausedEnrollments} />
        <CountCard label="Open handoff tasks" value={health.openHandoffTasks}
          alert={health.openHandoffTasks > 0}
          sub={health.urgentHandoffTasks > 0 ? `${health.urgentHandoffTasks} urgent` : undefined}
        />
        <CountCard label="Sent (24h)"    value={health.messagesLast24h.sent}    />
        <CountCard label="Received (24h)" value={health.messagesLast24h.received} />
        <CountCard label="Skipped (24h)" value={health.messagesLast24h.skipped}
          alert={health.messagesLast24h.skipped > 0}
        />
        <CountCard label="Failed (24h)"  value={health.messagesLast24h.failed}
          alert={health.messagesLast24h.failed > 0}
        />
      </div>

      {/* Skip reason breakdown */}
      {Object.keys(health.skipReasonBreakdown).length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Skip Reason Breakdown (24h)
          </h2>
          <div className="space-y-2">
            {Object.entries(health.skipReasonBreakdown)
              .sort(([, a], [, b]) => b - a)
              .map(([reason, count]) => {
                const pct = Math.round((count / health.messagesLast24h.skipped) * 100)
                return (
                  <div key={reason}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono text-gray-600">{reason}</span>
                      <span className="text-xs font-bold text-gray-900">{count} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-400 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
          </div>
          <Link href="/admin/dlr/suppression" className="mt-3 block text-xs text-red-600 hover:underline">
            Full suppression report →
          </Link>
        </div>
      )}
    </div>
  )
}

function HealthRow({
  label, status, okLabel, failLabel,
}: {
  label: string; status: boolean; okLabel: string; failLabel: string
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-600">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${status ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className={`text-sm font-semibold ${status ? 'text-green-600' : 'text-red-600'}`}>
          {status ? okLabel : failLabel}
        </span>
      </div>
    </div>
  )
}

function CountCard({
  label, value, sub, alert,
}: {
  label: string; value: number; sub?: string; alert?: boolean
}) {
  return (
    <div className={`bg-white rounded-xl border p-4 ${alert ? 'border-orange-200' : 'border-gray-200'}`}>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${alert ? 'text-orange-600' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}
