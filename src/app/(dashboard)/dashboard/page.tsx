import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { and, count, eq } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { leads, workflowEnrollments } from '@/lib/db/schema'

const LEAD_STATES = ['stale', 'enrolled', 'responded', 'revived', 'exhausted', 'opted_out'] as const

async function getFunnelCounts(tenantId: string) {
  const results = await Promise.all(
    LEAD_STATES.map((state) =>
      db
        .select({ count: count() })
        .from(leads)
        .where(and(eq(leads.tenantId, tenantId), eq(leads.state, state)))
        .then(([r]) => ({ state, count: r.count }))
    )
  )
  return Object.fromEntries(results.map(({ state, count }) => [state, count])) as Record<
    (typeof LEAD_STATES)[number],
    number
  >
}

async function getActiveEnrollments(tenantId: string) {
  const rows = await db
    .select({ count: count() })
    .from(workflowEnrollments)
    .innerJoin(leads, eq(workflowEnrollments.leadId, leads.id))
    .where(and(eq(leads.tenantId, tenantId), eq(workflowEnrollments.status, 'active')))
  return rows[0]?.count ?? 0
}

async function getEscalatedCount(tenantId: string) {
  const rows = await db
    .select({ count: count() })
    .from(workflowEnrollments)
    .innerJoin(leads, eq(workflowEnrollments.leadId, leads.id))
    .where(and(eq(leads.tenantId, tenantId), eq(workflowEnrollments.status, 'paused')))
  return rows[0]?.count ?? 0
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const [funnel, activeEnrollments, escalatedCount] = await Promise.all([
    getFunnelCounts(session.user.tenantId),
    getActiveEnrollments(session.user.tenantId),
    getEscalatedCount(session.user.tenantId),
  ])

  const cards = [
    { label: 'Stale leads', value: funnel.stale, color: 'text-yellow-600' },
    { label: 'In workflow', value: activeEnrollments, color: 'text-blue-600' },
    { label: 'Responded', value: funnel.responded, color: 'text-green-600' },
    { label: 'Revived', value: funnel.revived, color: 'text-emerald-600' },
    { label: 'Exhausted', value: funnel.exhausted, color: 'text-red-500' },
    { label: 'Escalated', value: escalatedCount, color: 'text-orange-500' },
    { label: 'Opted out', value: funnel.opted_out, color: 'text-gray-500' },
  ]

  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Dashboard</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-lg border border-gray-200 p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{card.label}</p>
            <p className={`mt-2 text-3xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 bg-white rounded-lg border border-gray-200 p-5">
        <p className="text-sm text-gray-500">
          Recovery rate:{' '}
          <span className="font-semibold text-gray-900">
            {funnel.enrolled + funnel.responded + funnel.revived + funnel.exhausted > 0
              ? Math.round(
                  (funnel.revived /
                    (funnel.enrolled + funnel.responded + funnel.revived + funnel.exhausted)) *
                    100
                )
              : 0}
            %
          </span>{' '}
          <span className="text-gray-400">
            ({funnel.revived} revived /{' '}
            {funnel.enrolled + funnel.responded + funnel.revived + funnel.exhausted} contacted)
          </span>
        </p>
      </div>
    </div>
  )
}
