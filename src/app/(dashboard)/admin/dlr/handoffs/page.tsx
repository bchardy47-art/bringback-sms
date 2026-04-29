import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { authOptions } from '@/lib/auth'
import { getHandoffQueue } from '@/lib/admin/dlr-queries'
import { resolveHandoffTask } from '@/lib/handoff/handoff-agent'
import { revalidatePath } from 'next/cache'

const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700',
  high:   'bg-orange-100 text-orange-700',
  normal: 'bg-blue-100 text-blue-700',
}

const TYPE_COLOR: Record<string, string> = {
  sales:      'bg-emerald-100 text-emerald-700',
  escalation: 'bg-red-100 text-red-700',
}

export default async function HandoffQueuePage({
  searchParams,
}: {
  searchParams: { status?: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const status = (searchParams.status ?? 'open') as 'open' | 'resolved' | 'dismissed' | 'all'
  const tasks  = await getHandoffQueue(session.user.tenantId, { status, limit: 200 })

  async function resolve(formData: FormData) {
    'use server'
    const taskId = formData.get('taskId') as string
    if (!taskId) return
    // Note: server action runs in server context — session already validated above
    await resolveHandoffTask({ taskId })
    revalidatePath('/admin/dlr/handoffs')
  }

  return (
    <div className="px-8 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Handoff Queue</h1>
          <p className="text-sm text-gray-500 mt-0.5">Leads waiting for human follow-up</p>
        </div>
        {/* Status filter */}
        <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
          {(['open', 'resolved', 'all'] as const).map((s) => (
            <Link
              key={s}
              href={`/admin/dlr/handoffs?status=${s}`}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors capitalize ${
                status === s ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {s}
            </Link>
          ))}
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-sm text-gray-400">
          {status === 'open' ? '✓ No open handoff tasks' : 'No tasks found.'}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Lead', 'Customer message', 'Priority', 'Type', 'Recommended action', 'Draft reply', 'Created', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/dlr/leads/${task.lead.id}`}
                      className="font-semibold text-gray-900 hover:text-red-600 whitespace-nowrap"
                    >
                      {task.lead.firstName} {task.lead.lastName}
                    </Link>
                    <p className="text-xs text-gray-400 font-mono">{task.lead.phone}</p>
                    {task.lead.vehicleOfInterest && (
                      <p className="text-xs text-gray-400">{task.lead.vehicleOfInterest}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 max-w-[180px]">
                    <p className="text-xs text-gray-700 italic line-clamp-2">
                      "{task.customerMessage}"
                    </p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${PRIORITY_COLOR[task.priority] ?? ''}`}>
                      {task.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${TYPE_COLOR[task.taskType] ?? ''}`}>
                      {task.taskType}
                    </span>
                  </td>
                  <td className="px-4 py-3 max-w-[180px]">
                    <p className="text-xs text-gray-600">{task.recommendedNextAction}</p>
                  </td>
                  <td className="px-4 py-3 max-w-[220px]">
                    {task.recommendedReply ? (
                      <p className="text-xs text-gray-500 italic line-clamp-2">
                        "{task.recommendedReply}"
                      </p>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-400">
                    {task.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {task.status === 'open' || task.status === 'in_progress' ? (
                      <form action={resolve}>
                        <input type="hidden" name="taskId" value={task.id} />
                        <button
                          type="submit"
                          className="px-2.5 py-1 text-xs font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                        >
                          Resolve
                        </button>
                      </form>
                    ) : (
                      <span className="text-xs text-gray-400">
                        {task.status} {task.resolvedAt ? `· ${task.resolvedAt.toLocaleDateString()}` : ''}
                      </span>
                    )}
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
