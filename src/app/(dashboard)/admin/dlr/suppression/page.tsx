import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { authOptions } from '@/lib/auth'
import { getSuppressionReport } from '@/lib/admin/dlr-queries'

const REASON_DESC: Record<string, string> = {
  test_lead:           'Lead is marked isTest=true',
  do_not_automate:     'Lead has doNotAutomate=true',
  opted_out:           'Lead sent STOP — on opt-out list',
  invalid_phone:       'Phone number is not valid E.164 format',
  tenant_paused:       'Tenant automation is paused',
  already_enrolled:    'Lead is already in an active enrollment',
  cooldown_active:     'Lead contacted too recently (cooldown period)',
  recently_contacted:  'Contacted within the minimum interval',
  lead_replied:        'Lead has replied since this step was scheduled',
  recent_human_contact:'Human contacted this lead within the pause window',
  sms_not_live:        'SMS_LIVE_MODE is not enabled',
  dry_run:             'DRY_RUN mode — sends suppressed',
  step_already_sent:   'This step was already sent (idempotency guard)',
  enrollment_not_active: 'Enrollment was cancelled before step ran',
  workflow_paused:     'Workflow is currently paused',
}

export default async function SuppressionPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const report = await getSuppressionReport(session.user.tenantId)

  const sortedReasons = Object.entries(report.summary).sort(([, a], [, b]) => b - a)

  return (
    <div className="px-8 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Suppression Report</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Leads blocked from enrollment or sends blocked by guards — {report.total} total events
        </p>
      </div>

      {report.total === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-sm text-gray-400">
          No suppression events found.
        </div>
      ) : (
        <>
          {/* Summary grid */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {sortedReasons.map(([reason, count]) => (
              <div key={reason} className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-2xl font-bold text-gray-900">{count}</p>
                <p className="text-xs font-mono text-gray-600 mt-0.5">{reason}</p>
                <p className="text-xs text-gray-400 mt-1">{REASON_DESC[reason] ?? ''}</p>
              </div>
            ))}
          </div>

          {/* Detail by reason */}
          {sortedReasons.map(([reason, count]) => {
            const entries = report.byReason[reason] ?? []
            return (
              <div key={reason} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-gray-900 font-mono">{reason}</span>
                    <span className="ml-3 text-xs text-gray-400">{count} events</span>
                  </div>
                  <span className="text-xs text-gray-400">{REASON_DESC[reason] ?? ''}</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">Lead</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">Phone</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">Source</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">Occurred</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">Layer</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.slice(0, 20).map((entry, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-xs font-semibold text-gray-900">
                          {entry.name}
                        </td>
                        <td className="px-4 py-2.5 text-xs font-mono text-gray-500">{entry.phone}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-400">
                          {entry.source === 'enrollment_block' ? 'Eligibility check' : 'Send guard'}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-400">
                          {entry.occurredAt.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs font-semibold ${entry.source === 'enrollment_block' ? 'text-orange-600' : 'text-red-600'}`}>
                            {entry.source === 'enrollment_block' ? 'enrollment' : 'send'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Link
                            href={`/admin/dlr/leads/${entry.leadId}`}
                            className="text-xs font-semibold text-red-600 hover:text-red-700"
                          >
                            View →
                          </Link>
                        </td>
                      </tr>
                    ))}
                    {entries.length > 20 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-2 text-xs text-gray-400 text-center">
                          … and {entries.length - 20} more
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
