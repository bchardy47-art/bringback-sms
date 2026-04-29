import { getServerSession } from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { getLeadDetail, setLeadFlag, markLeadDead } from '@/lib/admin/dlr-queries'
import { resolveHandoffTask } from '@/lib/handoff/handoff-agent'

const STATE_COLOR: Record<string, string> = {
  active:           'bg-gray-100 text-gray-700',
  stale:            'bg-yellow-100 text-yellow-700',
  revival_eligible: 'bg-yellow-100 text-yellow-600',
  enrolled:         'bg-blue-100 text-blue-700',
  responded:        'bg-green-100 text-green-700',
  revived:          'bg-emerald-100 text-emerald-700',
  exhausted:        'bg-red-100 text-red-600',
  converted:        'bg-purple-100 text-purple-700',
  opted_out:        'bg-gray-200 text-gray-500',
  dead:             'bg-gray-200 text-gray-400',
}

function Badge({ label, color }: { label: string; color?: string }) {
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${color ?? 'bg-gray-100 text-gray-600'}`}>
      {label}
    </span>
  )
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</span>
      <span className={`text-sm text-gray-900 ${mono ? 'font-mono' : ''}`}>
        {value ?? <span className="text-gray-300">—</span>}
      </span>
    </div>
  )
}

export default async function LeadDetailPage({
  params,
}: {
  params: { leadId: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const lead = await getLeadDetail(session.user.tenantId, params.leadId)
  if (!lead) notFound()

  // ── Server actions ─────────────────────────────────────────────────────────
  async function toggleIsTest(formData: FormData) {
    'use server'
    await setLeadFlag(session!.user.tenantId, params.leadId, 'isTest', !lead!.isTest)
    revalidatePath(`/admin/dlr/leads/${params.leadId}`)
  }
  async function toggleDoNotAutomate(formData: FormData) {
    'use server'
    await setLeadFlag(session!.user.tenantId, params.leadId, 'doNotAutomate', !lead!.doNotAutomate)
    revalidatePath(`/admin/dlr/leads/${params.leadId}`)
  }
  async function markDead() {
    'use server'
    await markLeadDead(session!.user.tenantId, params.leadId, 'Admin action from DLR control center')
    revalidatePath(`/admin/dlr/leads/${params.leadId}`)
  }
  async function resolveTask(formData: FormData) {
    'use server'
    const taskId = formData.get('taskId') as string
    if (taskId) {
      await resolveHandoffTask({ taskId, resolvedBy: session!.user.id })
      revalidatePath(`/admin/dlr/leads/${params.leadId}`)
    }
  }

  const stateBadge = STATE_COLOR[lead.state] ?? 'bg-gray-100 text-gray-600'

  return (
    <div className="px-8 py-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/admin/dlr" className="text-xs text-gray-400 hover:text-gray-600">← DLR Admin</Link>
          </div>
          <h1 className="text-xl font-bold text-gray-900">
            {lead.firstName} {lead.lastName}
          </h1>
          <p className="text-sm text-gray-500 font-mono">{lead.phone}</p>
        </div>
        <Badge label={lead.state} color={stateBadge} />
      </div>

      {/* Handoff task alert */}
      {lead.handoffTask && (
        <div className={`rounded-xl border p-4 ${lead.handoffTask.priority === 'urgent' ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-orange-200'}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className={`text-sm font-semibold ${lead.handoffTask.priority === 'urgent' ? 'text-red-700' : 'text-orange-700'}`}>
                ⚡ Open handoff task — {lead.handoffTask.priority} priority
              </p>
              <p className="text-xs text-gray-600 mt-1">
                "{lead.handoffTask.customerMessage}"
              </p>
              <p className="text-xs font-medium text-gray-700 mt-1.5">
                Action: {lead.handoffTask.recommendedNextAction}
              </p>
              {lead.handoffTask.recommendedReply && (
                <p className="text-xs text-gray-500 mt-1 italic">
                  Draft: "{lead.handoffTask.recommendedReply}"
                </p>
              )}
            </div>
            <form action={resolveTask}>
              <input type="hidden" name="taskId" value={lead.handoffTask.id} />
              <button
                type="submit"
                className="px-3 py-1.5 text-xs font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 whitespace-nowrap"
              >
                Resolve task
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* Lead info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Lead Info</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="CRM Source"   value={lead.crmSource} />
            <Field label="CRM Lead ID"  value={lead.crmLeadId} mono />
            <Field label="Vehicle"      value={lead.vehicleOfInterest} />
            <Field label="Salesperson"  value={lead.salespersonName} />
            <Field label="Email"        value={lead.email} />
            <Field label="Opted out"    value={lead.optedOut ? '⚠ Yes' : 'No'} />
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${lead.isTest ? 'bg-yellow-400' : 'bg-gray-200'}`} />
              <span className="text-xs text-gray-600">isTest</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${lead.doNotAutomate ? 'bg-red-400' : 'bg-gray-200'}`} />
              <span className="text-xs text-gray-600">doNotAutomate</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${lead.needsHumanHandoff ? 'bg-orange-400' : 'bg-gray-200'}`} />
              <span className="text-xs text-gray-600">needsHumanHandoff</span>
            </div>
          </div>
          {lead.suppressionReason && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-yellow-700">Suppressed from enrollment</p>
              <p className="text-xs font-mono text-yellow-600 mt-0.5">{lead.suppressionReason}</p>
            </div>
          )}
        </div>

        {/* Reply & contact */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Reply & Contact History</h2>
          <div className="space-y-3">
            <Field
              label="Last customer reply"
              value={lead.lastCustomerReplyAt?.toLocaleString() ?? '—'}
            />
            {lead.lastReplyBody && (
              <div>
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Reply body</span>
                <p className="text-sm text-gray-700 italic mt-0.5">"{lead.lastReplyBody}"</p>
              </div>
            )}
            <Field label="Classification"   value={lead.replyClassification} />
            <Field label="Classification reason" value={lead.replyClassificationReason} mono />
            <Field label="Last human contact" value={lead.lastHumanContactAt?.toLocaleString() ?? '—'} />
            <Field label="Last automated at"  value={lead.lastAutomatedAt?.toLocaleString() ?? '—'} />
          </div>
        </div>

        {/* Enrollment */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Enrollment</h2>
          {lead.enrollment ? (
            <div className="space-y-3">
              <Field label="Workflow"     value={lead.enrollment.workflowName} />
              <Field label="Status"       value={lead.enrollment.status} />
              <Field label="Step position" value={`#${lead.enrollment.currentStepPosition}`} />
              <Field label="Enrolled at"  value={lead.enrollment.enrolledAt.toLocaleString()} />
              {lead.enrollment.stopReason && (
                <div className="bg-red-50 border border-red-100 rounded-lg p-3">
                  <p className="text-xs font-semibold text-red-600">Stop reason</p>
                  <p className="text-xs font-mono text-red-500 mt-0.5">{lead.enrollment.stopReason}</p>
                  {lead.enrollment.stoppedAt && (
                    <p className="text-xs text-red-400 mt-0.5">{lead.enrollment.stoppedAt.toLocaleString()}</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No active enrollment.</p>
          )}
        </div>

        {/* Admin controls */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Admin Controls</h2>
          <p className="text-xs text-gray-400">
            All actions are audited. Changes take effect immediately.
          </p>
          <div className="flex flex-col gap-2">
            <form action={toggleIsTest}>
              <button
                type="submit"
                className="w-full text-left px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                {lead.isTest ? '✓ Mark as real lead (clear isTest)' : 'Mark as test lead'}
              </button>
            </form>
            <form action={toggleDoNotAutomate}>
              <button
                type="submit"
                className="w-full text-left px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                {lead.doNotAutomate ? '✓ Re-enable automation' : 'Block from automation (doNotAutomate)'}
              </button>
            </form>
            {lead.state !== 'dead' && (
              <form action={markDead}>
                <button
                  type="submit"
                  className="w-full text-left px-3 py-2 text-xs font-medium text-red-600 rounded-lg border border-red-100 hover:bg-red-50 transition-colors"
                >
                  Mark lead dead
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Recent messages */}
      {lead.recentMessages.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Recent Messages</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Time', 'Direction', 'Status', 'Body', 'Skip reason', 'Provider ID'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lead.recentMessages.map((msg) => (
                <tr key={msg.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs text-gray-400 whitespace-nowrap">
                    {msg.createdAt.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-semibold ${msg.direction === 'inbound' ? 'text-blue-600' : 'text-gray-600'}`}>
                      {msg.direction}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-semibold ${msg.status === 'sent' || msg.status === 'delivered' ? 'text-green-600' : msg.status === 'failed' ? 'text-red-600' : 'text-gray-500'}`}>
                      {msg.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 max-w-[200px]">
                    <p className="text-xs text-gray-600 truncate">{msg.body}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    {msg.skipReason ? (
                      <span className="text-xs font-mono text-red-600">{msg.skipReason}</span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs font-mono text-gray-400">
                      {msg.providerMessageId?.slice(0, 12) ?? '—'}
                    </span>
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
