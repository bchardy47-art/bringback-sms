/**
 * Command-center data layer — read-only aggregation for /admin (Brian's
 * cockpit). Combines the existing platform overview + outreach stats + first-
 * party activity into one payload, plus a unified "Needs Brian" task queue.
 *
 * No mutations, no sends, no schema changes. A few grouped aggregates (not
 * per-tenant N+1) feed the dealer status cards.
 */

import 'server-only'
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  tenants, leads, conversations, messages, pilotBatches, activityEvents,
} from '@/lib/db/schema'
import { getPlatformOverview, type PlatformStats } from './platform-queries'
import { getOutreachStats, type OutreachStats } from '@/lib/outreach/queries'

// Part 10 normalized task shape.
export type AdminTask = {
  id: string
  type: string
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  href: string
  entityName?: string
  createdAt?: Date | string
  badge?: string
}

export type DealerStatus = 'Setup' | 'Testing' | 'Ready' | 'Live' | 'Paused' | 'Blocked'

export type DealerCard = {
  tenantId: string
  name: string
  status: DealerStatus
  leads: number
  pilotBatches: number
  messagesSent: number
  replies: number
  lastActivityAt: Date | null
  blockingIssue: string | null
}

export type ActivityRow = {
  id: string
  eventType: string
  actorEmail: string | null
  actorRole: string | null
  tenantName: string | null
  createdAt: Date
}

export type SystemSnapshot = {
  smsLiveMode: boolean
  dryRun: boolean
  outreachSendEnabled: boolean
  failedSends24h: number
  skippedSends24h: number
  pendingApprovals: number
}

export type CommandCenter = {
  stats: PlatformStats
  outreach: OutreachStats
  dealers: DealerCard[]
  tasks: AdminTask[]
  recentActivity: ActivityRow[]
  lastDealerLoginAt: Date | null
  system: SystemSnapshot
}

function dealerStatusOf(t: typeof tenants.$inferSelect): { status: DealerStatus; blocking: string | null } {
  if (t.complianceBlocked) return { status: 'Blocked', blocking: t.complianceBlockReason || 'Compliance block active' }
  if (t.automationPaused) return { status: 'Paused', blocking: null }
  if (!t.smsSendingNumber) return { status: 'Setup', blocking: 'No sending number assigned' }
  if (!t.smsLiveApproved) return { status: 'Testing', blocking: 'SMS live approval pending' }
  if (t.liveActivatedAt) return { status: 'Live', blocking: null }
  return { status: 'Ready', blocking: null }
}

export async function getCommandCenter(now = new Date()): Promise<CommandCenter> {
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const [
    overview,
    outreach,
    tenantRows,
    leadCounts,
    batchCounts,
    msgRows,
    activityRows,
    lastDealerLogin,
    dealerActivity,
  ] = await Promise.all([
    getPlatformOverview(),
    getOutreachStats(now),
    db.select().from(tenants),
    db.select({ tenantId: leads.tenantId, n: sql<number>`count(*)::int` }).from(leads).groupBy(leads.tenantId),
    db.select({ tenantId: pilotBatches.tenantId, n: sql<number>`count(*)::int` }).from(pilotBatches).groupBy(pilotBatches.tenantId),
    db.select({
      tenantId: conversations.tenantId,
      direction: messages.direction,
      status: messages.status,
      n: sql<number>`count(*)::int`,
    })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .groupBy(conversations.tenantId, messages.direction, messages.status),
    db.select().from(activityEvents).orderBy(desc(activityEvents.createdAt)).limit(10),
    db.select({ v: sql<Date>`max(${activityEvents.createdAt})` })
      .from(activityEvents)
      .where(and(eq(activityEvents.eventType, 'login_success'), eq(activityEvents.actorRole, 'dealer'))),
    db.select({ tenantId: activityEvents.tenantId, v: sql<Date>`max(${activityEvents.createdAt})` })
      .from(activityEvents)
      .where(eq(activityEvents.actorRole, 'dealer'))
      .groupBy(activityEvents.tenantId),
  ])

  const leadById = new Map(leadCounts.map(r => [r.tenantId, r.n]))
  const batchById = new Map(batchCounts.map(r => [r.tenantId, r.n]))
  const lastActById = new Map(dealerActivity.map(r => [r.tenantId, r.v]))

  // messagesSent = outbound sent/delivered; replies = inbound received.
  const sentById = new Map<string, number>()
  const replyById = new Map<string, number>()
  for (const r of msgRows) {
    if (!r.tenantId) continue
    if (r.direction === 'outbound' && (r.status === 'sent' || r.status === 'delivered')) {
      sentById.set(r.tenantId, (sentById.get(r.tenantId) ?? 0) + r.n)
    }
    if (r.direction === 'inbound') {
      replyById.set(r.tenantId, (replyById.get(r.tenantId) ?? 0) + r.n)
    }
  }

  const dealers: DealerCard[] = tenantRows
    .map(t => {
      const { status, blocking } = dealerStatusOf(t)
      return {
        tenantId: t.id,
        name: t.name,
        status,
        leads: leadById.get(t.id) ?? 0,
        pilotBatches: batchById.get(t.id) ?? 0,
        messagesSent: sentById.get(t.id) ?? 0,
        replies: replyById.get(t.id) ?? 0,
        lastActivityAt: lastActById.get(t.id) ?? null,
        blockingIssue: blocking,
      }
    })
    .sort((a, b) => (b.lastActivityAt?.getTime() ?? 0) - (a.lastActivityAt?.getTime() ?? 0))

  // System snapshot
  const failedSends24h = msgRows
    .filter(r => r.status === 'failed')
    .reduce((s, r) => s + r.n, 0)
  // skipped is tracked on messages.skipReason, not status — approximate from a
  // direct 24h count to keep this read cheap and accurate.
  const [skip24, pendingApprovalsRow] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(gte(messages.createdAt, since24h), sql`${messages.skipReason} is not null`)),
    db.select({ n: sql<number>`count(*)::int` })
      .from(pilotBatches)
      .where(inArray(pilotBatches.status, ['previewed', 'approved'])),
  ])

  const system: SystemSnapshot = {
    smsLiveMode: process.env.SMS_LIVE_MODE === 'true',
    dryRun: process.env.DRY_RUN === 'true',
    outreachSendEnabled: process.env.OUTREACH_SEND_ENABLED === 'true',
    failedSends24h,
    skippedSends24h: skip24[0]?.n ?? 0,
    pendingApprovals: pendingApprovalsRow[0]?.n ?? 0,
  }

  const tasks = buildTasks(overview.stats, outreach, dealers, system)

  const recentActivity: ActivityRow[] = activityRows.map(r => ({
    id: r.id,
    eventType: r.eventType,
    actorEmail: r.actorEmail,
    actorRole: r.actorRole,
    tenantName: r.tenantName,
    createdAt: r.createdAt,
  }))

  return {
    stats: overview.stats,
    outreach,
    dealers,
    tasks,
    recentActivity,
    lastDealerLoginAt: lastDealerLogin[0]?.v ?? null,
    system,
  }
}

// ── Unified "Needs Brian" queue ──────────────────────────────────────────────

function buildTasks(
  stats: PlatformStats,
  outreach: OutreachStats,
  dealers: DealerCard[],
  system: SystemSnapshot,
): AdminTask[] {
  const tasks: AdminTask[] = []

  if (stats.urgentHandoffsAll > 0) {
    tasks.push({
      id: 'urgent_handoffs', type: 'handoff',
      title: `Resolve ${stats.urgentHandoffsAll} urgent handoff${stats.urgentHandoffsAll === 1 ? '' : 's'}`,
      description: 'Customer replies flagged urgent — review now.',
      priority: 'high', href: '/admin/dlr/handoffs',
      badge: String(stats.urgentHandoffsAll),
    })
  }
  if (stats.pilotBatchesToReview > 0) {
    tasks.push({
      id: 'pilot_review', type: 'pilot',
      title: `Review ${stats.pilotBatchesToReview} pilot batch${stats.pilotBatchesToReview === 1 ? '' : 'es'}`,
      description: 'Previewed/approved batches waiting on ops sign-off before send.',
      priority: 'high', href: '/admin/dlr/pilot', badge: String(stats.pilotBatchesToReview),
    })
  }
  if (stats.intakesNeedingAction > 0) {
    tasks.push({
      id: 'intakes', type: 'intake',
      title: `${stats.intakesNeedingAction} dealer intake${stats.intakesNeedingAction === 1 ? '' : 's'} need action`,
      description: 'Onboarding steps remain before these dealerships can go live.',
      priority: 'medium', href: '/admin/dlr/intakes', badge: String(stats.intakesNeedingAction),
    })
  }
  if (stats.numbersNeedingAssign > 0) {
    tasks.push({
      id: 'numbers', type: 'number',
      title: `Assign ${stats.numbersNeedingAssign} sending number${stats.numbersNeedingAssign === 1 ? '' : 's'}`,
      description: 'Provisioned tenants without a Telnyx sending number.',
      priority: 'medium', href: '/admin/dlr/intakes', badge: String(stats.numbersNeedingAssign),
    })
  }
  // Dealers missing SMS live approval (Testing status with that blocker).
  const liveApprovalNeeded = dealers.filter(d => d.blockingIssue === 'SMS live approval pending')
  if (liveApprovalNeeded.length > 0) {
    tasks.push({
      id: 'live_approval', type: 'dealer',
      title: `Approve SMS live for ${liveApprovalNeeded.length} dealer${liveApprovalNeeded.length === 1 ? '' : 's'}`,
      description: 'Number assigned but live sending not yet approved.',
      entityName: liveApprovalNeeded.map(d => d.name).slice(0, 3).join(', '),
      priority: 'medium', href: '/admin/dlr/dealers', badge: String(liveApprovalNeeded.length),
    })
  }
  if (stats.openHandoffsAll > 0) {
    tasks.push({
      id: 'open_handoffs', type: 'handoff',
      title: `${stats.openHandoffsAll} open handoff${stats.openHandoffsAll === 1 ? '' : 's'}`,
      description: 'Replies/escalations awaiting a human in the messages queue.',
      priority: 'low', href: '/admin/dlr/messages', badge: String(stats.openHandoffsAll),
    })
  }
  if (system.failedSends24h > 0) {
    tasks.push({
      id: 'failed_sends', type: 'system',
      title: `${system.failedSends24h} failed send${system.failedSends24h === 1 ? '' : 's'} in 24h`,
      description: 'Check messaging/provider health.',
      priority: 'high', href: '/admin/dlr/health', badge: String(system.failedSends24h),
    })
  }

  // Outreach tasks
  if (outreach.readyToSend > 0) {
    tasks.push({
      id: 'outreach_ready', type: 'outreach',
      title: `${outreach.readyToSend} prospect${outreach.readyToSend === 1 ? '' : 's'} eligible for a demo invite`,
      description: 'Researched dealerships ready for this month\'s controlled invite.',
      priority: 'medium', href: '/admin/outreach', badge: String(outreach.readyToSend),
    })
  }
  if (outreach.repliesInterested > 0) {
    tasks.push({
      id: 'outreach_replies', type: 'outreach',
      title: `${outreach.repliesInterested} outreach repl${outreach.repliesInterested === 1 ? 'y' : 'ies'} to follow up`,
      description: 'Prospects marked replied/interested — move toward a demo.',
      priority: 'high', href: '/admin/outreach?status=interested', badge: String(outreach.repliesInterested),
    })
  }
  if (outreach.missingEmailOrSource > 0) {
    tasks.push({
      id: 'outreach_missing', type: 'outreach',
      title: `${outreach.missingEmailOrSource} prospect${outreach.missingEmailOrSource === 1 ? '' : 's'} missing email/source`,
      description: 'Can\'t be contacted until a public email and source URL are added.',
      priority: 'low', href: '/admin/outreach?status=missing_contact', badge: String(outreach.missingEmailOrSource),
    })
  }

  const rank = { high: 0, medium: 1, low: 2 }
  return tasks.sort((a, b) => rank[a.priority] - rank[b.priority])
}
