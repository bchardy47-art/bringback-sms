import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { and, count, desc, eq, gte, sql } from 'drizzle-orm'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import {
  Activity, UserX, ArrowUpRight,
  MessageCircle, UserMinus, Send,
  TrendingUp, TrendingDown, Calendar,
} from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { leads, workflowEnrollments, conversations, messages } from '@/lib/db/schema'
import { FunnelViz } from '@/components/dashboard/FunnelViz'
import { InfoTooltip } from '@/components/ui/InfoTooltip'

const MessagesChart = dynamic(
  () => import('@/components/dashboard/MessagesChart').then((m) => m.MessagesChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[200px] flex items-center justify-center text-xs text-gray-400">
        Loading chart…
      </div>
    ),
  }
)

// ── Data helpers ───────────────────────────────────────────────────────────────

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

// Compare last 30 days vs prior 30 days for each lead state transition
async function getStateTrends(tenantId: string): Promise<Record<string, number>> {
  const rows = await db.execute(sql`
    SELECT
      lsh.to_state,
      COUNT(*) FILTER (WHERE lsh.created_at > NOW() - INTERVAL '30 days')::int  AS current_count,
      COUNT(*) FILTER (
        WHERE lsh.created_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days'
      )::int AS prev_count
    FROM lead_state_history lsh
    JOIN leads l ON lsh.lead_id = l.id
    WHERE l.tenant_id = ${tenantId}
      AND lsh.to_state IN ('stale', 'revived', 'responded', 'enrolled', 'opted_out')
      AND lsh.created_at > NOW() - INTERVAL '60 days'
    GROUP BY lsh.to_state
  `)

  const out: Record<string, number> = {}
  for (const row of (rows as unknown) as { to_state: string; current_count: number; prev_count: number }[]) {
    const cur = Number(row.current_count) || 0
    const prev = Number(row.prev_count) || 0
    out[row.to_state] = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0
  }
  return out
}

async function getRecentConversations(tenantId: string) {
  return db.query.conversations.findMany({
    where: eq(conversations.tenantId, tenantId),
    orderBy: [desc(conversations.updatedAt)],
    limit: 5,
    with: {
      lead: {
        columns: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          state: true,
          vehicleOfInterest: true,
        },
      },
      messages: { orderBy: (m, { desc }) => [desc(m.createdAt)], limit: 1 },
    },
  })
}

async function getChartData(tenantId: string) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const rows = await db
    .select({
      date: sql<string>`DATE(${messages.createdAt})`.as('date'),
      direction: messages.direction,
      cnt: count(),
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(conversations.tenantId, tenantId), gte(messages.createdAt, since)))
    .groupBy(sql`DATE(${messages.createdAt})`, messages.direction)
    .orderBy(sql`DATE(${messages.createdAt})`)

  const map = new Map<string, { sent: number; replies: number }>()
  for (const r of rows) {
    if (!map.has(r.date)) map.set(r.date, { sent: 0, replies: 0 })
    const entry = map.get(r.date)!
    if (r.direction === 'outbound') entry.sent += r.cnt
    else entry.replies += r.cnt
  }
  return Array.from(map.entries()).map(([date, v]) => ({
    date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    ...v,
  }))
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#be185d']
function nameToColor(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function timeAgo(d: Date | string) {
  const diff = Date.now() - new Date(d).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const hr = Math.floor(m / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

// Small inline chevron for dropdown buttons
function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M3 4.5L6 7.5L9 4.5" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const tenantId = session.user.tenantId

  const [funnel, activeEnrollments, recentConvos, chartData, trends] = await Promise.all([
    getFunnelCounts(tenantId),
    getActiveEnrollments(tenantId),
    getRecentConversations(tenantId),
    getChartData(tenantId),
    getStateTrends(tenantId),
  ])

  const contacted = funnel.enrolled + funnel.responded + funnel.revived + funnel.exhausted
  const recoveryRate = contacted > 0 ? Math.round((funnel.revived / contacted) * 100) : 0
  const totalLeads = Object.values(funnel).reduce((s, v) => s + v, 0)
  const replyRate =
    contacted > 0 ? Math.round(((funnel.responded + funnel.revived) / contacted) * 100) : 0

  // ── KPI card definitions ───────────────────────────────────────────────────
  const kpiCards = [
    {
      label: 'Stale Leads',
      tooltip: 'Leads with no CRM activity past your stale threshold. These are your revival candidates — the top of the funnel.',
      value: funnel.stale.toLocaleString(),
      trend: trends['stale'] ?? 0,
      Icon: UserMinus,
      iconBg: '#fee2e2',
      iconColor: '#dc2626',
      href: '/leads?state=stale',
    },
    {
      label: 'Revived Leads',
      tooltip: 'Leads that responded to outreach and re-entered active sales. This is your core success metric.',
      value: funnel.revived.toLocaleString(),
      trend: trends['revived'] ?? 0,
      Icon: Activity,
      iconBg: '#dcfce7',
      iconColor: '#16a34a',
      href: '/leads?state=revived',
    },
    {
      label: 'Conversations Started',
      tooltip: 'Leads currently enrolled in an active SMS workflow. Each one has received at least one automated message.',
      value: activeEnrollments.toLocaleString(),
      trend: trends['enrolled'] ?? 0,
      Icon: MessageCircle,
      iconBg: '#ffedd5',
      iconColor: '#ea580c',
      href: '/inbox',
    },
    {
      label: 'Responded',
      tooltip: 'Leads who replied to at least one SMS. Any inbound message — even a question — counts as a response.',
      value: funnel.responded.toLocaleString(),
      trend: trends['responded'] ?? 0,
      Icon: Calendar,
      iconBg: '#fff7ed',
      iconColor: '#f59e0b',
      href: '/leads?state=responded',
    },
    {
      label: 'Opted Out',
      tooltip: 'Leads who replied STOP or were manually unsubscribed. They will never receive another automated message.',
      value: funnel.opted_out.toLocaleString(),
      trend: trends['opted_out'] ?? 0,
      Icon: UserX,
      iconBg: '#f1f5f9',
      iconColor: '#64748b',
      href: '/inbox?status=opted_out',
    },
  ]

  // ── Funnel stages ──────────────────────────────────────────────────────────
  const funnelStages = [
    { label: 'Stale Leads Identified', sublabel: '', value: funnel.stale, color: '#ef4444' },
    {
      label: 'Conversations Started',
      sublabel: '',
      value: activeEnrollments,
      pct:
        funnel.stale > 0 ? `${Math.round((activeEnrollments / funnel.stale) * 100)}%` : '0%',
      color: '#f97316',
    },
    {
      label: 'Responded',
      sublabel: '',
      value: funnel.responded,
      pct:
        funnel.stale > 0 ? `${Math.round((funnel.responded / funnel.stale) * 100)}%` : '0%',
      color: '#eab308',
    },
    {
      label: 'Revived',
      sublabel: '',
      value: funnel.revived,
      pct:
        funnel.stale > 0 ? `${Math.round((funnel.revived / funnel.stale) * 100)}%` : '0%',
      color: '#22c55e',
    },
  ]

  return (
    <div className="min-h-full" style={{ backgroundColor: '#f1f2f4' }}>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div
        className="bg-white px-8 py-5"
        style={{ borderBottom: '1px solid #eceef0', boxShadow: '0 1px 0 rgba(0,0,0,0.03)' }}
      >
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm mt-0.5" style={{ color: '#9ca3af' }}>
          Overview of your lead revival performance
        </p>
      </div>

      <div className="px-8 py-7 space-y-5">
        {/* ── KPI cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {kpiCards.map(({ label, tooltip, value, trend, Icon, iconBg, iconColor, href }) => {
            const isUp = trend >= 0
            const TrendIcon = isUp ? TrendingUp : TrendingDown
            const trendColor = isUp ? '#16a34a' : '#dc2626'
            return (
              <Link
                key={label}
                href={href}
                className="bg-white rounded-2xl p-5 hover:-translate-y-0.5 transition-all duration-200 group"
                style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 4px 16px rgba(0,0,0,0.06)' }}
              >
                {/* Icon circle + info */}
                <div className="flex items-start justify-between mb-4">
                  <div
                    className="rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: iconBg, width: 52, height: 52 }}
                  >
                    <Icon size={24} style={{ color: iconColor }} strokeWidth={1.8} />
                  </div>
                  <InfoTooltip text={tooltip} direction="up" />
                </div>

                {/* Label */}
                <p className="text-xs font-medium mb-1.5 leading-snug" style={{ color: '#6b7280' }}>
                  {label}
                </p>

                {/* Big number */}
                <p className="text-[28px] font-black text-gray-900 mb-2 group-hover:text-red-600 transition-colors leading-none tracking-tight">
                  {value}
                </p>

                {/* Trend */}
                <div className="flex items-center gap-1">
                  <TrendIcon size={11} style={{ color: trendColor }} strokeWidth={2.5} />
                  <span className="text-xs font-bold" style={{ color: trendColor }}>
                    {Math.abs(trend)}%
                  </span>
                  <span className="text-xs ml-0.5" style={{ color: '#9ca3af' }}>vs last 30 days</span>
                </div>
              </Link>
            )
          })}
        </div>

        {/* ── Middle row ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Recovery Funnel */}
          <div
            className="bg-white rounded-2xl px-5 py-5"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 4px 16px rgba(0,0,0,0.05)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-semibold text-gray-900">Recovery Funnel</h2>
                <InfoTooltip text="Visualises how many stale leads convert at each revival stage. The percentages show each stage relative to the total stale pool." />
              </div>
              <button
                className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition-colors"
                style={{ color: '#6b7280', border: '1px solid #e9ebee' }}
              >
                Last 30 Days <ChevronDown />
              </button>
            </div>
            <FunnelViz steps={funnelStages} />
            <div className="mt-4 pt-3 flex items-center justify-between" style={{ borderTop: '1px solid #f0f1f3' }}>
              <span className="text-xs font-medium" style={{ color: '#9ca3af' }}>Recovery Rate</span>
              <span className="text-lg font-black" style={{ color: '#16a34a' }}>{recoveryRate}%</span>
            </div>
          </div>

          {/* Messages chart */}
          <div
            className="bg-white rounded-2xl p-6"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 4px 16px rgba(0,0,0,0.05)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-semibold text-gray-900">Messages Sent vs Replies</h2>
                <InfoTooltip text="Daily volume of outbound SMS messages sent by your workflows vs. inbound replies received from leads. Higher reply volume = more engagement." />
              </div>
              <button
                className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition-colors"
                style={{ color: '#6b7280', border: '1px solid #e9ebee' }}
              >
                Last 30 Days <ChevronDown />
              </button>
            </div>
            {chartData.length > 0 ? (
              <MessagesChart data={chartData} />
            ) : (
              <div className="h-[200px] flex flex-col items-center justify-center gap-2">
                <Activity size={24} style={{ color: '#e5e7eb' }} />
                <p className="text-xs" style={{ color: '#9ca3af' }}>No message data yet</p>
              </div>
            )}
          </div>

          {/* Dealership Summary */}
          <div
            className="bg-white rounded-2xl p-6 flex flex-col"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 4px 16px rgba(0,0,0,0.05)' }}
          >
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-semibold text-gray-900">Dealership Summary</h2>
                <InfoTooltip text="Aggregated performance snapshot for your dealership. Reply Rate = responded ÷ contacted. Recovery Rate = revived ÷ contacted." />
              </div>
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-white"
                style={{ backgroundColor: '#dc2626', fontSize: 10, letterSpacing: '0.1em' }}
              >
                DLR
              </div>
            </div>

            <dl className="flex-1">
              {[
                { label: 'Total Leads', value: totalLeads.toLocaleString() },
                { label: 'Stale (awaiting revival)', value: funnel.stale.toLocaleString() },
                { label: 'Active Sequences', value: activeEnrollments.toLocaleString() },
                { label: 'Responded', value: funnel.responded.toLocaleString() },
                { label: 'Revived', value: funnel.revived.toLocaleString() },
                { label: 'Reply Rate', value: `${replyRate}%` },
                { label: 'Recovery Rate', value: `${recoveryRate}%` },
              ].map((row, i) => (
                <div
                  key={row.label}
                  className="flex justify-between items-center py-2.5"
                  style={{ borderBottom: '1px solid #f4f5f6' }}
                >
                  <dt className="text-xs" style={{ color: '#9ca3af' }}>{row.label}</dt>
                  <dd className="text-sm font-semibold text-gray-900">{row.value}</dd>
                </div>
              ))}
            </dl>

            <Link
              href="/reports"
              className="mt-4 w-full py-2.5 text-center text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-1.5 hover:bg-red-50"
              style={{ backgroundColor: '#fff5f5', color: '#dc2626', border: '1px solid #fecaca' }}
            >
              View Full Report <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>

        {/* ── Bottom row ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Recent Conversations */}
          <div
            className="lg:col-span-2 bg-white rounded-2xl overflow-hidden"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 4px 16px rgba(0,0,0,0.05)' }}
          >
            <div
              className="flex items-center justify-between px-6 py-4"
              style={{ borderBottom: '1px solid #f3f4f6' }}
            >
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-semibold text-gray-900">Recent Lead Conversations</h2>
                <InfoTooltip text="The 5 most recently updated lead conversations. A green dot means the lead replied last. Click any row to open the full conversation thread." direction="down" />
              </div>
              <Link
                href="/inbox"
                className="text-xs font-semibold hover:text-red-700 transition-colors"
                style={{ color: '#dc2626' }}
              >
                View All
              </Link>
            </div>
            <div>
              {recentConvos.length === 0 ? (
                <p className="px-6 py-10 text-sm text-gray-400 text-center">
                  No conversations yet.
                </p>
              ) : (
                recentConvos.map((conv) => {
                  const lastMsg = conv.messages[0]
                  const isInbound = lastMsg?.direction === 'inbound'
                  const avatarColor = nameToColor(conv.lead.firstName)
                  const initials =
                    `${conv.lead.firstName[0] ?? ''}${conv.lead.lastName?.[0] ?? ''}`.toUpperCase()
                  const statusLabel =
                    isInbound ? 'Replied'
                    : conv.status === 'opted_out' ? 'Opted Out'
                    : 'Sent'
                  const statusStyle = isInbound
                    ? { backgroundColor: '#dcfce7', color: '#16a34a' }
                    : conv.status === 'opted_out'
                    ? { backgroundColor: '#fee2e2', color: '#dc2626' }
                    : { backgroundColor: '#f1f5f9', color: '#64748b' }

                  return (
                    <Link
                      key={conv.id}
                      href={`/inbox/${conv.id}`}
                      className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors duration-150"
                      style={{ borderBottom: '1px solid #f4f5f6' }}
                    >
                      <div
                        className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold"
                        style={{ backgroundColor: avatarColor }}
                      >
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900">
                          {conv.lead.firstName} {conv.lead.lastName}
                        </p>
                        <p className="text-xs text-gray-400 truncate">
                          {conv.lead.vehicleOfInterest ?? conv.lead.phone}
                        </p>
                      </div>
                      {lastMsg && (
                        <p className="text-xs text-gray-500 truncate max-w-[180px] hidden md:block">
                          {lastMsg.body}
                        </p>
                      )}
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span
                          className="text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
                          style={statusStyle}
                        >
                          {statusLabel}
                        </span>
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: isInbound ? '#22c55e' : '#d1d5db' }}
                        />
                      </div>
                    </Link>
                  )
                })
              )}
            </div>
          </div>

          {/* Activity Timeline */}
          <div className="bg-white rounded-2xl" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 4px 16px rgba(0,0,0,0.05)' }}>
            <div
              className="flex items-center justify-between px-6 py-4"
              style={{ borderBottom: '1px solid #f3f4f6' }}
            >
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-semibold text-gray-900">Activity Timeline</h2>
                <InfoTooltip text="Live feed of the most recent lead interactions — replies, outbound messages, and workflow events — sorted newest first." direction="down" />
              </div>
              <Link
                href="/inbox"
                className="text-xs font-semibold hover:text-red-700 transition-colors"
                style={{ color: '#dc2626' }}
              >
                View All
              </Link>
            </div>
            <div className="p-4 space-y-0.5">
              {recentConvos.length === 0 ? (
                <p className="py-8 text-xs text-gray-400 text-center">No activity yet.</p>
              ) : (
                recentConvos.slice(0, 5).map((conv) => {
                  const lastMsg = conv.messages[0]
                  const isReply = lastMsg?.direction === 'inbound'
                  const Icon = isReply ? MessageCircle : Send
                  const iconBg = isReply ? '#16a34a' : '#2563eb'

                  return (
                    <Link
                      key={conv.id}
                      href={`/inbox/${conv.id}`}
                      className="flex gap-3 p-2.5 rounded-xl hover:bg-gray-50 transition-colors"
                    >
                      {/* Timeline dot + icon */}
                      <div className="flex flex-col items-center gap-1 flex-shrink-0">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: iconBg }}
                        >
                          <Icon size={14} style={{ color: '#ffffff' }} strokeWidth={2.2} />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 pt-0.5">
                        <p className="text-xs font-semibold text-gray-800 leading-tight">
                          {isReply
                            ? `${conv.lead.firstName} ${conv.lead.lastName} replied`
                            : `Message sent to ${conv.lead.firstName} ${conv.lead.lastName}`}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5 truncate">
                          {conv.lead.vehicleOfInterest
                            ? `Re: ${conv.lead.vehicleOfInterest}`
                            : conv.lead.phone}
                        </p>
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0 pt-0.5">
                        {timeAgo(conv.updatedAt)}
                      </span>
                    </Link>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
