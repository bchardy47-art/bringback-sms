import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { and, count, desc, eq } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { leads, conversations, messages, workflowEnrollments } from '@/lib/db/schema'
import { BarChart3, TrendingUp, MessageSquare, Users, AlertCircle, RefreshCw } from 'lucide-react'

const LEAD_STATES = ['stale', 'enrolled', 'responded', 'revived', 'exhausted', 'opted_out'] as const

export default async function ReportsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const tenantId = session.user.tenantId

  // Fetch all the metrics in parallel
  const [funnelResults, totalMessages, totalConversations, activeEnrollments, exhaustedCount] =
    await Promise.all([
      Promise.all(
        LEAD_STATES.map((state) =>
          db
            .select({ count: count() })
            .from(leads)
            .where(and(eq(leads.tenantId, tenantId), eq(leads.state, state)))
            .then(([r]) => ({ state, count: r.count }))
        )
      ),
      db
        .select({ count: count() })
        .from(messages)
        .innerJoin(conversations, eq(messages.conversationId, conversations.id))
        .where(eq(conversations.tenantId, tenantId))
        .then((r) => r[0]?.count ?? 0),
      db
        .select({ count: count() })
        .from(conversations)
        .where(eq(conversations.tenantId, tenantId))
        .then((r) => r[0]?.count ?? 0),
      db
        .select({ count: count() })
        .from(workflowEnrollments)
        .innerJoin(leads, eq(workflowEnrollments.leadId, leads.id))
        .where(and(eq(leads.tenantId, tenantId), eq(workflowEnrollments.status, 'active')))
        .then((r) => r[0]?.count ?? 0),
      db
        .select({ count: count() })
        .from(workflowEnrollments)
        .innerJoin(leads, eq(workflowEnrollments.leadId, leads.id))
        .where(and(eq(leads.tenantId, tenantId), eq(workflowEnrollments.status, 'completed')))
        .then((r) => r[0]?.count ?? 0),
    ])

  const funnel = Object.fromEntries(funnelResults.map(({ state, count }) => [state, count])) as Record<
    (typeof LEAD_STATES)[number],
    number
  >

  const contacted = funnel.enrolled + funnel.responded + funnel.revived + funnel.exhausted
  const recoveryRate = contacted > 0 ? ((funnel.revived / contacted) * 100).toFixed(1) : '0.0'
  const responseRate = contacted > 0 ? ((funnel.responded / contacted) * 100).toFixed(1) : '0.0'
  const optOutRate =
    contacted > 0 ? ((funnel.opted_out / (contacted + funnel.opted_out)) * 100).toFixed(1) : '0.0'

  const summaryCards = [
    {
      label: 'Total Leads',
      value: (funnel.stale + contacted + funnel.opted_out).toLocaleString(),
      icon: <Users size={20} className="text-blue-500" />,
      bg: 'bg-blue-50',
    },
    {
      label: 'Total Conversations',
      value: totalConversations.toLocaleString(),
      icon: <MessageSquare size={20} className="text-violet-500" />,
      bg: 'bg-violet-50',
    },
    {
      label: 'Total Messages Sent',
      value: totalMessages.toLocaleString(),
      icon: <MessageSquare size={20} className="text-indigo-500" />,
      bg: 'bg-indigo-50',
    },
    {
      label: 'Recovery Rate',
      value: `${recoveryRate}%`,
      icon: <TrendingUp size={20} className="text-emerald-500" />,
      bg: 'bg-emerald-50',
    },
    {
      label: 'Response Rate',
      value: `${responseRate}%`,
      icon: <RefreshCw size={20} className="text-green-500" />,
      bg: 'bg-green-50',
    },
    {
      label: 'Opt-Out Rate',
      value: `${optOutRate}%`,
      icon: <AlertCircle size={20} className="text-red-500" />,
      bg: 'bg-red-50',
    },
  ]

  const funnelRows = [
    { label: 'Stale (identified)',  value: funnel.stale,     color: '#ef4444', pct: 100 },
    { label: 'Enrolled (contacted)', value: funnel.enrolled,  color: '#f97316', pct: funnel.stale > 0 ? Math.round((funnel.enrolled  / funnel.stale) * 100) : 0 },
    { label: 'Responded',           value: funnel.responded, color: '#eab308', pct: funnel.stale > 0 ? Math.round((funnel.responded / funnel.stale) * 100) : 0 },
    { label: 'Revived',             value: funnel.revived,   color: '#22c55e', pct: funnel.stale > 0 ? Math.round((funnel.revived   / funnel.stale) * 100) : 0 },
    { label: 'Exhausted',           value: funnel.exhausted, color: '#94a3b8', pct: funnel.stale > 0 ? Math.round((funnel.exhausted / funnel.stale) * 100) : 0 },
    { label: 'Opted Out',           value: funnel.opted_out, color: '#f43f5e', pct: funnel.stale > 0 ? Math.round((funnel.opted_out / funnel.stale) * 100) : 0 },
  ]

  const maxFunnelVal = Math.max(...funnelRows.map((r) => r.value), 1)

  return (
    <div className="min-h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-5">
        <h1 className="text-xl font-bold text-gray-900">Reports</h1>
        <p className="text-sm text-gray-500 mt-0.5">Campaign performance and lead pipeline analytics</p>
      </div>

      <div className="px-8 py-6 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {summaryCards.map((card) => (
            <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${card.bg}`}>
                {card.icon}
              </div>
              <p className="text-2xl font-bold text-gray-900">{card.value}</p>
              <p className="text-xs text-gray-500 mt-1">{card.label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Full funnel breakdown */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-5">Lead Funnel Breakdown</h2>
            <div className="space-y-4">
              {funnelRows.map((row) => (
                <div key={row.label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-gray-600">{row.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-800">{row.value.toLocaleString()}</span>
                      <span className="text-xs text-gray-400 w-8 text-right">{row.pct}%</span>
                    </div>
                  </div>
                  <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.round((row.value / maxFunnelVal) * 100)}%`,
                        backgroundColor: row.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Conversion metrics */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-5">Conversion Metrics</h2>
            <div className="space-y-5">
              <Metric
                label="Recovery Rate"
                description="Revived leads out of all contacted"
                numerator={funnel.revived}
                denominator={contacted}
                color="bg-emerald-500"
              />
              <Metric
                label="Response Rate"
                description="Leads who replied out of all contacted"
                numerator={funnel.responded}
                denominator={contacted}
                color="bg-green-400"
              />
              <Metric
                label="Exhaustion Rate"
                description="Leads who didn't respond after all steps"
                numerator={funnel.exhausted}
                denominator={contacted}
                color="bg-slate-400"
              />
              <Metric
                label="Opt-Out Rate"
                description="Leads who opted out of all reached"
                numerator={funnel.opted_out}
                denominator={contacted + funnel.opted_out}
                color="bg-red-400"
              />
            </div>
          </div>
        </div>

        {/* Pipeline status table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Pipeline Status</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr style={{ backgroundColor: '#fafafa', borderBottom: '1px solid #f3f4f6' }}>
                {['Stage', 'Leads', '% of Total', 'Status'].map((h) => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {funnelRows.map((row, i) => {
                const total = funnel.stale + contacted + funnel.opted_out || 1
                const pctOfTotal = ((row.value / total) * 100).toFixed(1)
                const statusLabel =
                  row.label.includes('Revived') ? '✓ Won' :
                  row.label.includes('Exhausted') ? '× Lost' :
                  row.label.includes('Opted') ? '⊘ Blocked' :
                  '→ Active'
                const statusColor =
                  row.label.includes('Revived') ? 'text-emerald-600' :
                  row.label.includes('Exhausted') || row.label.includes('Opted') ? 'text-red-500' :
                  'text-blue-600'

                return (
                  <tr key={row.label} style={{ borderBottom: i < funnelRows.length - 1 ? '1px solid #f9fafb' : undefined }}>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: row.color }} />
                        <span className="text-sm font-medium text-gray-800">{row.label}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-sm font-semibold text-gray-900">
                      {row.value.toLocaleString()}
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pctOfTotal}%`, backgroundColor: row.color }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">{pctOfTotal}%</span>
                      </div>
                    </td>
                    <td className={`px-6 py-3.5 text-xs font-semibold ${statusColor}`}>
                      {statusLabel}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Metric({
  label,
  description,
  numerator,
  denominator,
  color,
}: {
  label: string
  description: string
  numerator: number
  denominator: number
  color: string
}) {
  const pct = denominator > 0 ? (numerator / denominator) * 100 : 0
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div>
          <p className="text-sm font-semibold text-gray-800">{label}</p>
          <p className="text-xs text-gray-400">{description}</p>
        </div>
        <span className="text-xl font-bold text-gray-900">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden mt-2">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <p className="text-xs text-gray-400 mt-1">{numerator.toLocaleString()} / {denominator.toLocaleString()}</p>
    </div>
  )
}
