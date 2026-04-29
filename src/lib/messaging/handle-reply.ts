/**
 * Reply Handler
 *
 * Orchestrates everything that happens when a non-STOP, non-UNSTOP inbound
 * message arrives for a known lead.  Called from inbound.ts after the message
 * has been persisted to the messages table.
 *
 * Responsibilities (in order):
 *  1. Classify the reply (keyword/rule-based)
 *  2. Stamp lastCustomerReplyAt on the lead (send-guard dependency)
 *  3. Update classification fields + needsHumanHandoff
 *  4. Cancel all active enrollments for this lead (proactive stop)
 *  5. Transition lead state machine if enrolled (enrolled → responded)
 *  6. For wrong_number: additionally transition to dead
 *
 * Returns a structured result for the caller to use in logging / alerting.
 *
 * Pure write path — does not send messages or query external services.
 */

import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { leads, workflowEnrollments } from '@/lib/db/schema'
import { classifyReply, HANDOFF_CLASSIFICATIONS, type ReplyClassification } from './classify-reply'
import { transition, type LeadState } from '@/lib/lead/state-machine'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReplyHandlingResult = {
  leadId: string
  classification: ReplyClassification
  classificationReason: string
  needsHumanHandoff: boolean
  enrollmentsCancelled: number
  previousState: LeadState
  newState: LeadState        // state after all transitions (may equal previousState)
  stateTransitioned: boolean
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function handleReply(params: {
  leadId: string
  body: string
}): Promise<ReplyHandlingResult> {
  const { leadId, body } = params

  // ── Load current lead ──────────────────────────────────────────────────────
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) })
  if (!lead) throw new Error(`[handle-reply] Lead ${leadId} not found`)

  const previousState = lead.state as LeadState
  const now = new Date()

  // ── 1. Classify ────────────────────────────────────────────────────────────
  const { classification, reason: classificationReason } = classifyReply(body)
  const needsHumanHandoff = HANDOFF_CLASSIFICATIONS.has(classification)

  // ── 2 & 3. Stamp reply fields ──────────────────────────────────────────────
  await db.update(leads).set({
    lastCustomerReplyAt: now,          // used by send-guard lead_replied check
    lastReplyBody: body.slice(0, 1000), // cap — SMS bodies are short but be safe
    replyClassification: classification,
    replyClassificationReason: classificationReason,
    needsHumanHandoff,
    updatedAt: now,
  }).where(eq(leads.id, leadId))

  // ── 4. Cancel active enrollments ───────────────────────────────────────────
  //
  // Proactive cancellation so the audit trail is clean and the operator sees
  // an immediate stop reason. The send-guard's lead_replied check would block
  // sends anyway, but this makes the enrollment record authoritative.
  const cancelled = await db.update(workflowEnrollments).set({
    status: 'cancelled',
    completedAt: now,
    stopReason: `inbound_reply:${classification}`,
    stoppedAt: now,
  }).where(and(
    eq(workflowEnrollments.leadId, leadId),
    eq(workflowEnrollments.status, 'active'),
  )).returning({ id: workflowEnrollments.id })
  const enrollmentsCancelled = cancelled.length

  // ── 5 & 6. State transitions ───────────────────────────────────────────────
  //
  // enrolled → responded  for any non-STOP reply when lead is enrolled
  // responded → dead      for wrong_number (the number belongs to someone else)
  // revived   → dead      for wrong_number (same)
  //
  // For all other classifications the lead stays at responded — the human
  // agent handles next steps (convert, re-enroll, mark dead, etc.).

  let newState: LeadState = previousState
  let stateTransitioned = false

  if (previousState === 'enrolled') {
    try {
      await transition(leadId, 'responded', {
        reason: `Inbound reply classified as ${classification}`,
      })
      newState = 'responded'
      stateTransitioned = true
    } catch (err) {
      // Log but don't throw — the reply fields and enrollment cancellation
      // already happened and are more important than the state transition.
      console.error(`[handle-reply] enrolled→responded transition failed for ${leadId}:`, err)
    }
  }

  // wrong_number: terminal — mark dead so the number is never contacted again
  if (
    classification === 'wrong_number' &&
    (newState === 'enrolled' || newState === 'responded' || newState === 'revived')
  ) {
    try {
      // May need to go via responded if still enrolled
      if (newState === 'enrolled') {
        await transition(leadId, 'responded', { reason: 'Inbound reply: wrong_number (via responded)' })
        newState = 'responded'
      }
      await transition(leadId, 'dead', { reason: 'Wrong number confirmed by inbound reply' })
      newState = 'dead'
      stateTransitioned = true
    } catch (err) {
      console.error(`[handle-reply] →dead transition failed for ${leadId}:`, err)
    }
  }

  console.log(
    `[reply] Lead ${leadId} | ${previousState}→${newState} | ` +
    `classification=${classification} | handoff=${needsHumanHandoff} | ` +
    `enrollments_cancelled=${enrollmentsCancelled}` +
    (classificationReason ? ` | matched="${classificationReason}"` : '')
  )

  return {
    leadId,
    classification,
    classificationReason,
    needsHumanHandoff,
    enrollmentsCancelled,
    previousState,
    newState,
    stateTransitioned,
  }
}
