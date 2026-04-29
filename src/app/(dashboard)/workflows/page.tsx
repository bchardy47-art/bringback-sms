import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { eq, count } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { workflows, workflowEnrollments } from '@/lib/db/schema'
import { Zap, MessageSquare, GitBranch, Users } from 'lucide-react'

const STEP_ICONS: Record<string, React.ReactNode> = {
  send_sms:  <MessageSquare size={13} className="text-blue-500" />,
  condition: <GitBranch size={13} className="text-orange-500" />,
  assign:    <Users size={13} className="text-purple-500" />,
}

const STEP_COLORS: Record<string, string> = {
  send_sms:  'bg-blue-50 border-blue-200 text-blue-700',
  condition: 'bg-orange-50 border-orange-200 text-orange-700',
  assign:    'bg-purple-50 border-purple-200 text-purple-700',
}

export default async function WorkflowsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const [wfs, enrollmentCounts] = await Promise.all([
    db.query.workflows.findMany({
      where: eq(workflows.tenantId, session.user.tenantId),
      with: { steps: { orderBy: (s, { asc }) => [asc(s.position)] } },
      orderBy: (w, { desc }) => [desc(w.createdAt)],
    }),
    db
      .select({ workflowId: workflowEnrollments.workflowId, count: count() })
      .from(workflowEnrollments)
      .where(eq(workflowEnrollments.status, 'active'))
      .groupBy(workflowEnrollments.workflowId),
  ])

  const countMap = Object.fromEntries(enrollmentCounts.map((r) => [r.workflowId, r.count]))

  return (
    <div className="min-h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Workflows</h1>
            <p className="text-sm text-gray-500 mt-0.5">Build and manage automated SMS campaigns</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1.5 rounded-lg font-mono">
              POST /api/workflows
            </span>
          </div>
        </div>
      </div>

      <div className="px-8 py-6">
        {wfs.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <Zap size={24} className="text-gray-400" />
            </div>
            <h3 className="text-sm font-semibold text-gray-700 mb-1">No workflows yet</h3>
            <p className="text-xs text-gray-400">
              Create workflows via{' '}
              <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono">POST /api/workflows</code>{' '}
              or run{' '}
              <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono">npm run db:seed</code>
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {wfs.map((wf) => {
              const enrollCount = countMap[wf.id] ?? 0
              return (
                <div key={wf.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  {/* Card header */}
                  <div className="px-6 py-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <h2 className="text-base font-bold text-gray-900">{wf.name}</h2>
                          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                            wf.isActive
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-500'
                          }`}>
                            {wf.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        {wf.description && (
                          <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">{wf.description}</p>
                        )}
                      </div>

                      {/* Stats */}
                      <div className="flex-shrink-0 text-right">
                        <p className="text-2xl font-bold text-blue-600">{enrollCount}</p>
                        <p className="text-xs text-gray-400">Active leads</p>
                      </div>
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center gap-5 mt-3 text-xs text-gray-400">
                      <span>
                        Trigger:{' '}
                        <span className="font-medium text-gray-600">{wf.triggerType.replace('_', ' ')}</span>
                      </span>
                      {wf.triggerConfig?.daysInactive && (
                        <span>
                          After{' '}
                          <span className="font-medium text-gray-600">
                            {wf.triggerConfig.daysInactive} days
                          </span>{' '}
                          inactive
                        </span>
                      )}
                      <span>
                        <span className="font-medium text-gray-600">{wf.steps.length}</span> steps
                      </span>
                    </div>
                  </div>

                  {/* Steps flow */}
                  {wf.steps.length > 0 && (
                    <div className="px-6 py-4 border-t border-gray-50 bg-gray-50/50">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                        Workflow Steps
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {wf.steps.map((step, i) => {
                          const delay = step.type === 'send_sms'
                            ? (step.config as { delayHours?: number }).delayHours
                            : null
                          const colorClass = STEP_COLORS[step.type] ?? 'bg-gray-50 border-gray-200 text-gray-600'
                          const icon = STEP_ICONS[step.type] ?? <Zap size={13} />
                          const label = step.type === 'send_sms' ? 'SMS'
                            : step.type === 'condition' ? 'Condition'
                            : step.type === 'assign' ? 'Assign'
                            : step.type

                          return (
                            <div key={step.id} className="flex items-center gap-2">
                              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold ${colorClass}`}>
                                {icon}
                                <span>
                                  Step {i + 1} · {label}
                                  {delay ? ` (+${delay}h)` : ''}
                                </span>
                              </div>
                              {i < wf.steps.length - 1 && (
                                <svg width="16" height="8" viewBox="0 0 16 8" className="text-gray-300 flex-shrink-0">
                                  <path d="M0 4h12M9 1l4 3-4 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
