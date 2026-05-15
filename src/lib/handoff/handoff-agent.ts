/**
 * Handoff Agent  (Phase 5b — Automotive-aware)
 *
 * Creates structured human follow-up tasks when inbound replies are classified
 * as hot/warm or as complaints requiring escalation.
 *
 * Heat scoring:
 *   hot  → hot_appointment, hot_payment, hot_inventory
 *   warm → warm_trade, warm_finance, needs_human_review
 *   null → angry_or_complaint (escalation — not a sales opportunity)
 *
 * Triggering classifications (must match HANDOFF_CLASSIFICATIONS in classify-reply.ts):
 *   hot_appointment  → sales task, priority: urgent
 *   hot_payment      → sales task, priority: urgent
 *   hot_inventory    → sales task, priority: high
 *   warm_trade       → sales task, priority: high
 *   warm_finance     → sales task, priority: high
 *   needs_human_review → sales task, priority: normal
 *   angry_or_complaint → escalation task, priority: urgent
 *
 * not_now and neutral_unclear intentionally excluded — no handoff.
 *
 * Dedup:
 *   Only one open/in_progress task per lead is allowed. If one already exists,
 *   createHandoffTask() returns { created: false, reason: 'duplicate_open_task' }.
 *
 * Resolving:
 *   resolveHandoffTask() marks the task resolved and stamps lead.lastHumanContactAt
 *   so the send-guard's recent_human_contact check stays accurate.
 */

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { handoffTasks, leads } from '@/lib/db/schema'
import { extractSignals, buildSalesSummary, type AutomotiveSignals } from '@/lib/messaging/automotive-signals'
import type { ReplyClassification } from '@/lib/messaging/classify-reply'

// ── Heat scoring ──────────────────────────────────────────────────────────────

export type HeatScore = 'hot' | 'warm'

const HEAT_MAP: Partial<Record<ReplyClassification, HeatScore>> = {
  hot_appointment:   'hot',
  hot_payment:       'hot',
  hot_inventory:     'hot',
  warm_trade:        'warm',
  warm_finance:      'warm',
  needs_human_review:'warm',
  // angry_or_complaint: no heat score — escalation path only
}

// ── Classification metadata ────────────────────────────────────────────────────

/** Classifications that require a handoff task to be created.
 *  Keep in sync with HANDOFF_CLASSIFICATIONS in classify-reply.ts. */
export const HANDOFF_TRIGGERING_CLASSIFICATIONS = new Set<ReplyClassification>([
  'hot_appointment',
  'hot_inventory',
  'hot_payment',
  'warm_trade',
  'warm_finance',
  'needs_human_review',
  'angry_or_complaint',
])

const TASK_TYPE: Partial<Record<ReplyClassification, 'sales' | 'escalation'>> = {
  hot_appointment:    'sales',
  hot_payment:        'sales',
  hot_inventory:      'sales',
  warm_trade:         'sales',
  warm_finance:       'sales',
  needs_human_review: 'sales',
  angry_or_complaint: 'escalation',
}

const PRIORITY: Partial<Record<ReplyClassification, 'urgent' | 'high' | 'normal'>> = {
  hot_appointment:    'urgent',
  hot_payment:        'urgent',
  hot_inventory:      'high',
  warm_trade:         'high',
  warm_finance:       'high',
  needs_human_review: 'normal',
  angry_or_complaint: 'urgent',
}

const RECOMMENDED_ACTION: Partial<Record<ReplyClassification, string>> = {
  hot_appointment:    'Call or text to confirm appointment time.',
  hot_payment:        'Call immediately — customer is ready to buy.',
  hot_inventory:      'Call to confirm vehicle availability and invite for test drive.',
  warm_trade:         'Ask about trade-in and present options.',
  warm_finance:       'Follow up with financing options.',
  needs_human_review: 'Review reply and respond manually.',
  angry_or_complaint: 'Escalate to manager. Do not automate further.',
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
    case 'hot_appointment':
      return `Hey ${firstName}, sounds great! When works best for you to come in?`
    case 'hot_payment':
      return `Hey ${firstName}, happy to help get you into ${v}! I'll reach out shortly to go over the numbers.`
    case 'hot_inventory':
      return `Hey ${firstName}, let me check availability on ${v} and get back to you right away!`
    case 'warm_trade':
      return `Hey ${firstName}, great news — we accept trade-ins! I'd love to help figure out what ${v} could be worth.`
    case 'warm_finance':
      return `Hey ${firstName}, happy to go over financing options for ${v}. I'll have someone reach out shortly.`
    case 'needs_human_review':
      return `Hey ${firstName}, thanks for the reply! Let me have someone follow up with you directly.`
    case 'angry_or_complaint':
      return null  // No suggested reply — escalation only
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

  // ── Extract automotive signals from the customer message ──────────────────
  const signals: AutomotiveSignals = extractSignals(
    customerMessage,
    lead.vehicleOfInterest ?? null
  )

  const priority            = PRIORITY[classification]            ?? 'normal'
  const taskType            = TASK_TYPE[classification]           ?? 'sales'
  const recommendedAction   = RECOMMENDED_ACTION[classification]  ?? 'Review and respond manually.'
  const recommendedReply    = buildRecommendedReply(classification, lead.firstName, lead.vehicleOfInterest ?? null)
  const heatScore           = HEAT_MAP[classification]            ?? null
  const salesSummary        = taskType === 'sales'
    ? buildSalesSummary(signals, lead.firstName, lead.vehicleOfInterest ?? null)
    : null

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
    heatScore,
    salesSummary,
    automotiveSignals: signals as Record<string, unknown>,
  }).returning()

  console.log(
    `[handoff] Task ${task.id} created | lead=${leadId} | ` +
    `type=${taskType} | classification=${classification} | ` +
    `priority=${priority} | heat=${heatScore ?? 'n/a'}` +
    (salesSummary ? ` | summary="${salesSummary}"` : '')
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
