import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { eq, count, and } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { workflows, workflowEnrollments } from '@/lib/db/schema'

export default async function WorkflowsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const wfs = await db.query.workflows.findMany({
    where: eq(workflows.tenantId, session.user.tenantId),
    with: {
      steps: { orderBy: (s, { asc }) => [asc(s.position)] },
    },
    orderBy: (w, { desc }) => [desc(w.createdAt)],
  })

  // Get active enrollment counts per workflow
  const enrollmentCounts = await db
    .select({ workflowId: workflowEnrollments.workflowId, count: count() })
    .from(workflowEnrollments)
    .where(eq(workflowEnrollments.status, 'active'))
    .groupBy(workflowEnrollments.workflowId)

  const countMap = Object.fromEntries(enrollmentCounts.map((r) => [r.workflowId, r.count]))

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Workflows</h1>
          <p className="text-xs text-gray-400 mt-1">
            Workflows are created via the API or seed script. Code-first.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {wfs.length === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-sm text-gray-400">
              No workflows yet. Create one via <code className="bg-gray-100 px-1 rounded">POST /api/workflows</code> or run{' '}
              <code className="bg-gray-100 px-1 rounded">npm run db:seed</code>.
            </p>
          </div>
        )}

        {wfs.map((wf) => (
          <div key={wf.id} className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-gray-900">{wf.name}</h2>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    wf.isActive
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    {wf.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                {wf.description && (
                  <p className="text-xs text-gray-500 mt-1">{wf.description}</p>
                )}
                <div className="flex gap-4 mt-2 text-xs text-gray-400">
                  <span>Trigger: <strong className="text-gray-600">{wf.triggerType}</strong></span>
                  {wf.triggerConfig?.daysInactive && (
                    <span>After <strong className="text-gray-600">{wf.triggerConfig.daysInactive} days</strong> inactive</span>
                  )}
                  <span><strong className="text-gray-600">{wf.steps.length}</strong> steps</span>
                  <span>
                    <strong className="text-blue-600">{countMap[wf.id] ?? 0}</strong> active enrollments
                  </span>
                </div>
              </div>
            </div>

            {/* Steps preview */}
            <div className="mt-4 flex gap-2 flex-wrap">
              {wf.steps.map((step, i) => (
                <div key={step.id} className="flex items-center gap-1">
                  <span className="text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 text-gray-600">
                    {i + 1}. {step.type === 'send_sms' ? '💬 SMS' : step.type === 'condition' ? '⚡ Condition' : '👤 Assign'}
                    {step.type === 'send_sms' && (step.config as { delayHours?: number }).delayHours
                      ? ` (+${(step.config as { delayHours: number }).delayHours}h)`
                      : ''}
                  </span>
                  {i < wf.steps.length - 1 && <span className="text-gray-300 text-xs">→</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
