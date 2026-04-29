/**
 * Handoff Agent  (Phase 5)
 *
 * Creates structured human follow-up tasks when inbound replies are classified
 * as warm/hot or as complaints requiring escalation.
 *
 * Triggering classifications:
 *   interested          → sales task, priority: high
 *   appointment_request → sales task, priority: urgent
 *   callback_request    → sales task, priority: high
 *   question            → sales task, priority: normal
 *   angry_or_complaint  → escalation task, priority: urgent
 *
 * Dedup:
 *   Only one open/in_progress task per lead is allowed. If one already exists,
 *   createHandoffTask() returns { created: false, reason: 'duplicate_open_task' }
 *   without inserting a new row. The caller can inspect existingTaskId to surface
 *   it to the operator.
 *
 * Resolving:
 *   resolveHandoffTask() marks the task resolved and stamps lead.lastHumanContactAt
 *   so the send-guard's recent_human_contact check stays accurate.
 */

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { handoffTasks, leads } from '@/lib/db/schema'
import type { ReplyClassification } from '@/lib/messaging/classify-reply'

// ── Classification metadata ────────────────────────────────────────────────────

/** Classifications that require a handoff task to be created. */
export const HANDOFF_TRIGGERING_CLASSIFICATIONS = new Set<ReplyClassification>([
  'interested',
  'appointment_request',
  'callback_request',
  'question',
  'angry_or_complaint', // escalation — not a sales opportunity
])

const TASK_TYPE: Partial<Record<ReplyClassification, 'sales' | 'escalation'>> = {
  interested:          'sales',
  appointment_request: 'sales',
  callback_request:    'sales',
  question:            'sales',
  angry_or_complaint:  'escalation',
}

const PRIORITY: Partial<Record<ReplyClassification, 'urgent' | 'high' | 'normal'>> = {
  appointment_request: 'urgent',
  callback_request:    'high',
  interested:          'high',
  question:            'normal',
  angry_or_complaint:  'urgent',
}

const RECOMMENDED_ACTION: Partial<Record<ReplyClassification, string>> = {
  appointment_request: 'Call or text to confirm appointment time.',
  callback_request:    'Call the customer back as requested.',
  interested:          'Reply and qualify vehicle interest.',
  question:            "Answer the customer's question and continue manually.",
  angry_or_complaint:  'Escalate to manager. Do not automate further.',
}

/**
 * Build a short, human-ready suggested reply with lead variables resolved.
 * Returns null for complaints (do not suggest engaging with an angry customer).
 */
function buildRecommendedReply(
  classification: ReplyClassification,
  firstName: string,
  vehicle: string | null
): string | null {
  const v = vehicle ?? 'the vehicle'
  switch (classification) {
    case 'appointment_request':
      return `Hey ${firstName}, sounds great! When works best for you to come in?`
    case 'callback_request':
      return `Hey ${firstName}, I'll give you a call shortly. What's the best time to reach you?`
    case 'interested':
      return `Hey ${firstName}, happy to help! What would you like to know about the ${v}?`
    case 'question':
      return `Hey ${firstName}, yes, I can check that for you — are you asking about the ${v}?`
    case 'angry_or_complaint':
      return null  // No suggested reply — do not engage automatically
    default:
      return null
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type HandoffTaskRow = typeof handoffTasks.$inferSelect

export type CreateHandoffResult =
  | { created: true; task: HandoffTaskRow }
  | { created: false; reason: 'duplicate_open_task'; existingTaskId: string }
  | { created: false; reason: 'classification_not_handoff' }

// ── createHandoffTask ─────────────────────────────────────────────────────────

export async function createHandoffTask(params: {
  tenantId: string
  leadId: string
  conversationId?: string
  classification: ReplyClassification
  customerMessage: string
}): Promise<CreateHandoffResult> {
  const { tenantId, leadId, conversationId, classification, customerMessage } = params

  // ── Guard: only create tasks for triggering classifications ────────────────
  if (!HANDOFF_TRIGGERING_CLASSIFICATIONS.has(classification)) {
    return { created: false, reason: 'classification_not_handoff' }
  }

  // ── Dedup: reject if an open/in_progress task already exists for this lead ─
  const existing = await db.query.handoffTasks.findFirst({
    where: and(
      eq(handoffTasks.leadId, leadId),
      inArray(handoffTasks.status, ['open', 'in_progress']),
    ),
  })
  if (existing) {
    console.log(
      `[handoff] Lead ${leadId} already has open task ${existing.id} ` +
      `(${existing.classification}/${existing.status}) — skipping duplicate`
    )
    return { created: false, reason: 'duplicate_open_task', existingTaskId: existing.id }
  }

  // ── Load lead for template variable resolution ─────────────────────────────
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) })
  if (!lead) throw new Error(`[handoff] Lead ${leadId} not found`)

  const priority            = PRIORITY[classification]            ?? 'normal'
  const taskType            = TASK_TYPE[classification]           ?? 'sales'
  const recommendedAction   = RECOMMENDED_ACTION[classification]  ?? 'Review and respond manually.'
  const recommendedReply    = buildRecommendedReply(classification, lead.firstName, lead.vehicleOfInterest ?? null)

  const [task] = await db.insert(handoffTasks).values({
    tenantId,
    leadId,
    conversationId,
    classification,
    taskType,
    priority,
    customerMessage: customerMessage.slice(0, 2000),
    recommendedNextAction: recommendedAction,
    recommendedReply,
    status: 'open',
  }).returning()

  console.log(
    `[handoff] Task ${task.id} created | lead=${leadId} | ` +
    `type=${taskType} | classification=${classification} | priority=${priority}`
  )

  return { created: true, task }
}

// ── resolveHandoffTask ────────────────────────────────────────────────────────

/**
 * Mark a handoff task resolved and (by default) stamp lead.lastHumanContactAt.
 * Stamping lastHumanContactAt keeps the send-guard's recent_human_contact check
 * accurate if the lead is ever re-enrolled.
 */
export async function resolveHandoffTask(params: {
  taskId: string
  resolvedBy?: string   // users.id — optional; null = resolved by system/unknown
  stampHumanContact?: boolean  // default true
}): Promise<void> {
  const { taskId, resolvedBy, stampHumanContact = true } = params

  const task = await db.query.handoffTasks.findFirst({
    where: eq(handoffTasks.id, taskId),
  })
  if (!task) throw new Error(`[handoff] Task ${taskId} not found`)
  if (task.status === 'resolved' || task.status === 'dismissed') {
    console.log(`[handoff] Task ${taskId} already ${task.status} — no-op`)
    return
  }

  const now = new Date()

  await db.update(handoffTasks).set({
    status:     'resolved',
    resolvedAt: now,
    resolvedBy: resolvedBy ?? null,
    updatedAt:  now,
  }).where(eq(handoffTasks.id, taskId))

  if (stampHumanContact) {
    await db.update(leads).set({
      lastHumanContactAt: now,
      updatedAt: now,
    }).where(eq(leads.id, task.leadId))
  }

  console.log(
    `[handoff] Task ${taskId} resolved | lead=${task.leadId} | ` +
    `resolvedBy=${resolvedBy ?? 'system'}` +
    (stampHumanContact ? ' | lastHumanContactAt stamped' : '')
  )
}
