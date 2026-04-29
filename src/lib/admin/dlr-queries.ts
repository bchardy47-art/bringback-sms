/**
 * DLR Admin Query Layer
 *
 * All read-side data access for the admin visibility / control center.
 * Functions are pure queries — no side effects, no mutations.
 *
 * Designed to answer six operational questions:
 *   1. Which leads need human attention?        → getHandoffQueue
 *   2. Which leads are enrolled in automation?  → getAutomationHealth (enrollments)
 *   3. Which leads were suppressed and why?     → getSuppressionReport
 *   4. Which messages were sent/skipped/failed? → getMessageAuditLog
 *   5. What is the state of handoff tasks?      → getHandoffQueue
 *   6. Why was a specific lead contacted/not?   → getLeadDetail
 *   7. Is automation live/paused?               → getAutomationHealth
 */

import { and, desc, eq, gte, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  conversations,
  handoffTasks,
  leads,
  messages,
  optOuts,
  tenants,
  workflowEnrollments,
  workflows,
  workflowStepExecutions,
} from '@/lib/db/schema'

// ── Shared types ──────────────────────────────────────────────────────────────

export type LeadSnippet = {
  id: string
  firstName: string
  lastName: string
  phone: string
  vehicleOfInterest: string | null
  crmSource: string
}

// ── A. Handoff Queue ──────────────────────────────────────────────────────────

export type HandoffQueueItem = {
  id: string
  tenantId: string
  lead: LeadSnippet
  conversationId: string | null
  classification: string
  taskType: string
  priority: string
  customerMessage: string
  recommendedNextAction: string
  recommendedReply: string | null
  status: string
  assignedTo: string | null
  createdAt: Date
  resolvedAt: Date | null
}

/**
 * Returns handoff tasks sorted by priority (urgent first) then createdAt (oldest first).
 * Default: open + in_progress tasks only. Pass status='all' for full history.
 */
export async function getHandoffQueue(
  tenantId: string,
  opts: {
    status?: 'open' | 'in_progress' | 'resolved' | 'dismissed' | 'all'
    limit?: number
    offset?: number
  } = {}
): Promise<HandoffQueueItem[]> {
  const { status = 'open', limit = 100, offset = 0 } = opts

  const statusFilter =
    status === 'all'
      ? undefined
      : status === 'open'
        ? inArray(handoffTasks.status, ['open', 'in_progress'])
        : eq(handoffTasks.status, status)

  const conditions = [
    eq(handoffTasks.tenantId, tenantId),
    ...(statusFilter ? [statusFilter] : []),
  ]

  const rows = await db.query.handoffTasks.findMany({
    where: and(...conditions),
    with: { lead: true },
    orderBy: [
      // Priority: urgent → high → normal
      sql`CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END`,
      handoffTasks.createdAt,
    ],
    limit,
    offset,
  })

  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenantId,
    lead: {
      id: row.lead.id,
      firstName: row.lead.firstName,
      lastName: row.lead.lastName,
      phone: row.lead.phone,
      vehicleOfInterest: row.lead.vehicleOfInterest ?? null,
      crmSource: row.lead.crmSource,
    },
    conversationId: row.conversationId ?? null,
    classification: row.classification,
    taskType: row.taskType,
    priority: row.priority,
    customerMessage: row.customerMessage,
    recommendedNextAction: row.recommendedNextAction,
    recommendedReply: row.recommendedReply ?? null,
    status: row.status,
    assignedTo: row.assignedTo ?? null,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt ?? null,
  }))
}

// ── B. Lead Detail ────────────────────────────────────────────────────────────

export type LeadDetail = {
  // Core lead fields
  id: string
  tenantId: string
  firstName: string
  lastName: string
  phone: string
  email: string | null
  vehicleOfInterest: string | null
  crmSource: string
  crmLeadId: string | null
  salespersonName: string | null
  state: string
  isTest: boolean
  doNotAutomate: boolean
  suppressionReason: string | null
  // Reply fields
  lastCustomerReplyAt: Date | null
  lastReplyBody: string | null
  replyClassification: string | null
  replyClassificationReason: string | null
  needsHumanHandoff: boolean
  // Human contact
  lastHumanContactAt: Date | null
  lastAutomatedAt: Date | null
  // Computed
  optedOut: boolean
  // Active enrollment (if any)
  enrollment: {
    id: string
    workflowId: string
    workflowName: string
    status: string
    enrolledAt: Date
    currentStepPosition: number
    stopReason: string | null
    stoppedAt: Date | null
  } | null
  // Recent messages (up to 20, newest first)
  recentMessages: {
    id: string
    direction: string
    body: string
    status: string
    skipReason: string | null
    skippedAt: Date | null
    sentAt: Date | null
    providerMessageId: string | null
    createdAt: Date
    stepExecutionId: string | null
  }[]
  // Open handoff task if any
  handoffTask: {
    id: string
    classification: string
    taskType: string
    priority: string
    status: string
    createdAt: Date
    customerMessage: string
    recommendedNextAction: string
    recommendedReply: string | null
  } | null
}

export async function getLeadDetail(
  tenantId: string,
  leadId: string
): Promise<LeadDetail | null> {
  // ── 1. Load lead ─────────────────────────────────────────────────────────
  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)),
  })
  if (!lead) return null

  // ── 2. Opt-out status ─────────────────────────────────────────────────────
  const optOut = await db.query.optOuts.findFirst({
    where: and(eq(optOuts.tenantId, tenantId), eq(optOuts.phone, lead.phone)),
  })

  // ── 3. Active enrollment ──────────────────────────────────────────────────
  const enrollment = await db.query.workflowEnrollments.findFirst({
    where: and(
      eq(workflowEnrollments.leadId, leadId),
      inArray(workflowEnrollments.status, ['active', 'paused']),
    ),
    orderBy: [desc(workflowEnrollments.enrolledAt)],
    with: { workflow: true },
  })

  // ── 4. Recent messages via conversation ───────────────────────────────────
  const conv = await db.query.conversations.findFirst({
    where: and(eq(conversations.leadId, leadId), eq(conversations.tenantId, tenantId)),
  })

  const recentMessages = conv
    ? await db.query.messages.findMany({
        where: eq(messages.conversationId, conv.id),
        orderBy: [desc(messages.createdAt)],
        limit: 20,
      })
    : []

  // ── 5. Open handoff task ──────────────────────────────────────────────────
  const handoffTask = await db.query.handoffTasks.findFirst({
    where: and(
      eq(handoffTasks.leadId, leadId),
      inArray(handoffTasks.status, ['open', 'in_progress']),
    ),
  })

  return {
    id: lead.id,
    tenantId: lead.tenantId,
    firstName: lead.firstName,
    lastName: lead.lastName,
    phone: lead.phone,
    email: lead.email ?? null,
    vehicleOfInterest: lead.vehicleOfInterest ?? null,
    crmSource: lead.crmSource,
    crmLeadId: lead.crmLeadId ?? null,
    salespersonName: lead.salespersonName ?? null,
    state: lead.state,
    isTest: lead.isTest,
    doNotAutomate: lead.doNotAutomate,
    suppressionReason: lead.suppressionReason ?? null,
    lastCustomerReplyAt: lead.lastCustomerReplyAt ?? null,
    lastReplyBody: lead.lastReplyBody ?? null,
    replyClassification: lead.replyClassification ?? null,
    replyClassificationReason: lead.replyClassificationReason ?? null,
    needsHumanHandoff: lead.needsHumanHandoff,
    lastHumanContactAt: lead.lastHumanContactAt ?? null,
    lastAutomatedAt: lead.lastAutomatedAt ?? null,
    optedOut: !!optOut,
    enrollment: enrollment
      ? {
          id: enrollment.id,
          workflowId: enrollment.workflowId,
          workflowName: enrollment.workflow.name,
          status: enrollment.status,
          enrolledAt: enrollment.enrolledAt,
          currentStepPosition: enrollment.currentStepPosition,
          stopReason: enrollment.stopReason ?? null,
          stoppedAt: enrollment.stoppedAt ?? null,
        }
      : null,
    recentMessages: recentMessages.map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      status: m.status,
      skipReason: m.skipReason ?? null,
      skippedAt: m.skippedAt ?? null,
      sentAt: m.sentAt ?? null,
      providerMessageId: m.providerMessageId ?? null,
      createdAt: m.createdAt,
      stepExecutionId: m.stepExecutionId ?? null,
    })),
    handoffTask: handoffTask
      ? {
          id: handoffTask.id,
          classification: handoffTask.classification,
          taskType: handoffTask.taskType,
          priority: handoffTask.priority,
          status: handoffTask.status,
          createdAt: handoffTask.createdAt,
          customerMessage: handoffTask.customerMessage,
          recommendedNextAction: handoffTask.recommendedNextAction,
          recommendedReply: handoffTask.recommendedReply ?? null,
        }
      : null,
  }
}

// ── C. Automation Health ──────────────────────────────────────────────────────

export type AutomationHealth = {
  tenant: {
    id: string
    name: string
    automationPaused: boolean
  }
  smsLiveMode: boolean
  dryRun: boolean
  activeWorkflows: number
  totalWorkflows: number
  activeEnrollments: number
  pausedEnrollments: number
  openHandoffTasks: number
  urgentHandoffTasks: number
  messagesLast24h: {
    sent: number
    skipped: number
    failed: number
    received: number
  }
  skipReasonBreakdown: Record<string, number>
}

export async function getAutomationHealth(tenantId: string): Promise<AutomationHealth | null> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  })
  if (!tenant) return null

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

  // Workflow counts
  const allWorkflows = await db.query.workflows.findMany({
    where: eq(workflows.tenantId, tenantId),
  })
  const activeWorkflows = allWorkflows.filter((w) => w.isActive).length

  // Enrollment counts
  const activeEnrollments = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workflowEnrollments)
    .innerJoin(leads, eq(workflowEnrollments.leadId, leads.id))
    .where(and(eq(leads.tenantId, tenantId), eq(workflowEnrollments.status, 'active')))
    .then((r) => r[0]?.count ?? 0)

  const pausedEnrollments = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workflowEnrollments)
    .innerJoin(leads, eq(workflowEnrollments.leadId, leads.id))
    .where(and(eq(leads.tenantId, tenantId), eq(workflowEnrollments.status, 'paused')))
    .then((r) => r[0]?.count ?? 0)

  // Handoff task counts
  const openHandoffTasks = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(handoffTasks)
    .where(and(eq(handoffTasks.tenantId, tenantId), inArray(handoffTasks.status, ['open', 'in_progress'])))
    .then((r) => r[0]?.count ?? 0)

  const urgentHandoffTasks = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(handoffTasks)
    .where(and(
      eq(handoffTasks.tenantId, tenantId),
      inArray(handoffTasks.status, ['open', 'in_progress']),
      eq(handoffTasks.priority, 'urgent'),
    ))
    .then((r) => r[0]?.count ?? 0)

  // Message stats (last 24h) — join through conversations → leads for tenant filter
  const recentMsgs = await db
    .select({
      status: messages.status,
      skipReason: messages.skipReason,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(
      eq(conversations.tenantId, tenantId),
      gte(messages.createdAt, since24h),
    ))

  const msgCounts = { sent: 0, skipped: 0, failed: 0, received: 0 }
  const skipBreakdown: Record<string, number> = {}

  for (const msg of recentMsgs) {
    if (msg.status === 'sent' || msg.status === 'delivered') msgCounts.sent++
    else if (msg.status === 'failed') msgCounts.failed++
    else if (msg.status === 'received') msgCounts.received++
    if (msg.skipReason) {
      msgCounts.skipped++
      skipBreakdown[msg.skipReason] = (skipBreakdown[msg.skipReason] ?? 0) + 1
    }
  }

  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      automationPaused: tenant.automationPaused,
    },
    smsLiveMode: process.env.SMS_LIVE_MODE === 'true',
    dryRun: process.env.DRY_RUN === 'true',
    activeWorkflows,
    totalWorkflows: allWorkflows.length,
    activeEnrollments,
    pausedEnrollments,
    openHandoffTasks,
    urgentHandoffTasks,
    messagesLast24h: msgCounts,
    skipReasonBreakdown: skipBreakdown,
  }
}

// ── D. Message Audit Log ──────────────────────────────────────────────────────

export type MessageAuditItem = {
  id: string
  conversationId: string
  lead: LeadSnippet
  direction: string
  body: string
  status: string
  skipReason: string | null
  skippedAt: Date | null
  sentAt: Date | null
  deliveredAt: Date | null
  providerMessageId: string | null
  stepExecutionId: string | null
  createdAt: Date
}

export async function getMessageAuditLog(
  tenantId: string,
  opts: {
    limit?: number
    offset?: number
    leadId?: string
    direction?: 'inbound' | 'outbound'
    skipReasonOnly?: boolean
  } = {}
): Promise<MessageAuditItem[]> {
  const { limit = 100, offset = 0, leadId, direction, skipReasonOnly } = opts

  // Build conversation filter: all conversations for this tenant (+ optional leadId)
  const convConditions = [eq(conversations.tenantId, tenantId)]
  if (leadId) convConditions.push(eq(conversations.leadId, leadId))

  const convRows = await db.query.conversations.findMany({
    where: and(...convConditions),
    with: { lead: true },
  })
  const convMap = new Map(convRows.map((c) => [c.id, c]))
  const convIds = convRows.map((c) => c.id)

  if (convIds.length === 0) return []

  const msgConditions = [inArray(messages.conversationId, convIds)]
  if (direction) msgConditions.push(eq(messages.direction, direction))
  if (skipReasonOnly) msgConditions.push(isNotNull(messages.skipReason))

  const rows = await db.query.messages.findMany({
    where: and(...msgConditions),
    orderBy: [desc(messages.createdAt)],
    limit,
    offset,
  })

  return rows.map((m) => {
    const conv = convMap.get(m.conversationId)
    const lead = conv?.lead
    return {
      id: m.id,
      conversationId: m.conversationId,
      lead: lead
        ? {
            id: lead.id,
            firstName: lead.firstName,
            lastName: lead.lastName,
            phone: lead.phone,
            vehicleOfInterest: lead.vehicleOfInterest ?? null,
            crmSource: lead.crmSource,
          }
        : { id: '', firstName: '(unknown)', lastName: '', phone: '', vehicleOfInterest: null, crmSource: '' },
      direction: m.direction,
      body: m.body,
      status: m.status,
      skipReason: m.skipReason ?? null,
      skippedAt: m.skippedAt ?? null,
      sentAt: m.sentAt ?? null,
      deliveredAt: m.deliveredAt ?? null,
      providerMessageId: m.providerMessageId ?? null,
      stepExecutionId: m.stepExecutionId ?? null,
      createdAt: m.createdAt,
    }
  })
}

// ── E. Suppression Report ────────────────────────────────────────────────────

export type SuppressionEntry = {
  leadId: string
  name: string
  phone: string
  reason: string
  source: 'enrollment_block' | 'send_guard'
  occurredAt: Date
}

export type SuppressionReport = {
  byReason: Record<string, SuppressionEntry[]>
  summary: Record<string, number>
  total: number
}

export async function getSuppressionReport(
  tenantId: string,
  opts: { limit?: number } = {}
): Promise<SuppressionReport> {
  const { limit = 500 } = opts
  const entries: SuppressionEntry[] = []

  // ── 1. Leads suppressed at enrollment (suppressionReason set) ─────────────
  const suppressedLeads = await db.query.leads.findMany({
    where: and(
      eq(leads.tenantId, tenantId),
      isNotNull(leads.suppressionReason),
    ),
    orderBy: [desc(leads.updatedAt)],
    limit,
  })
  for (const lead of suppressedLeads) {
    entries.push({
      leadId: lead.id,
      name: `${lead.firstName} ${lead.lastName}`,
      phone: lead.phone,
      reason: lead.suppressionReason!,
      source: 'enrollment_block',
      occurredAt: lead.updatedAt,
    })
  }

  // ── 2. Messages skipped by send guard (skipReason set) ────────────────────
  const convRows = await db.query.conversations.findMany({
    where: eq(conversations.tenantId, tenantId),
    with: { lead: true },
  })
  const convMap = new Map(convRows.map((c) => [c.id, c]))
  const convIds = convRows.map((c) => c.id)

  if (convIds.length > 0) {
    const skippedMsgs = await db.query.messages.findMany({
      where: and(
        inArray(messages.conversationId, convIds),
        isNotNull(messages.skipReason),
      ),
      orderBy: [desc(messages.createdAt)],
      limit,
    })
    for (const msg of skippedMsgs) {
      const conv = convMap.get(msg.conversationId)
      const lead = conv?.lead
      if (!lead) continue
      entries.push({
        leadId: lead.id,
        name: `${lead.firstName} ${lead.lastName}`,
        phone: lead.phone,
        reason: msg.skipReason!,
        source: 'send_guard',
        occurredAt: msg.skippedAt ?? msg.createdAt,
      })
    }
  }

  // Group by reason
  const byReason: Record<string, SuppressionEntry[]> = {}
  const summary: Record<string, number> = {}

  for (const entry of entries) {
    byReason[entry.reason] ??= []
    byReason[entry.reason].push(entry)
    summary[entry.reason] = (summary[entry.reason] ?? 0) + 1
  }

  return { byReason, summary, total: entries.length }
}

// ── Admin controls (mutations) ────────────────────────────────────────────────

export async function pauseTenantAutomation(tenantId: string): Promise<void> {
  const { db: dbClient } = await import('@/lib/db')
  await dbClient.update(tenants).set({ automationPaused: true, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId))
  console.log(`[admin] Tenant ${tenantId} automation PAUSED`)
}

export async function resumeTenantAutomation(tenantId: string): Promise<void> {
  const { db: dbClient } = await import('@/lib/db')
  await dbClient.update(tenants).set({ automationPaused: false, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId))
  console.log(`[admin] Tenant ${tenantId} automation RESUMED`)
}

export async function setLeadFlag(
  tenantId: string,
  leadId: string,
  flag: 'isTest' | 'doNotAutomate',
  value: boolean
): Promise<void> {
  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)),
  })
  if (!lead) throw new Error(`Lead ${leadId} not found in tenant ${tenantId}`)
  await db.update(leads).set({ [flag]: value, updatedAt: new Date() }).where(eq(leads.id, leadId))
  console.log(`[admin] Lead ${leadId} ${flag}=${value}`)
}

export async function markLeadDead(tenantId: string, leadId: string, reason: string): Promise<void> {
  const { transition } = await import('@/lib/lead/state-machine')
  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)),
  })
  if (!lead) throw new Error(`Lead ${leadId} not found`)
  if (lead.state === 'dead') return  // already dead, no-op
  await transition(leadId, 'dead', { reason: `Admin action: ${reason}`, actor: 'admin' })
  console.log(`[admin] Lead ${leadId} marked dead — reason: ${reason}`)
}
