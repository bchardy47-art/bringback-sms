import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { conversations, leads, messages, messageStatusEvents, workflowEnrollments } from '@/lib/db/schema'
import type { StatusEvent } from './provider.interface'
import { transition } from '@/lib/lead/state-machine'

// Telnyx (and most carrier-fronting providers) surface a handful of failure
// strings that indicate the destination number itself is undeliverable —
// landline, unallocated, not_mobile, etc. Once we see one of these for a lead
// there's no point sending again, so we halt all automation for them.
const INVALID_DESTINATION_PATTERNS = [
  /invalid\s*(to\s*)?number/i,
  /not\s*a\s*mobile/i,
  /landline/i,
  /unallocated/i,
  /unreachable/i,
  /undeliverable\s*destination/i,
  /not_in_service/i,
  /number_not_in_service/i,
  /invalid_destination/i,
]

function isInvalidDestinationFailure(reason: string | undefined | null): boolean {
  if (!reason) return false
  return INVALID_DESTINATION_PATTERNS.some((re) => re.test(reason))
}

export async function handleStatusEvent(event: StatusEvent): Promise<void> {
  const message = await db.query.messages.findFirst({
    where: eq(messages.providerMessageId, event.providerMessageId),
  })

  if (!message) {
    // Telnyx can send status events for messages we haven't logged yet (race on send).
    // Log and return — if this is a retry webhook the message will be found next time.
    console.warn(`[messaging/status] No message found for providerMessageId ${event.providerMessageId}`)
    return
  }

  // Idempotency: if we've already recorded this exact status, skip the duplicate.
  const alreadyRecorded = await db.query.messageStatusEvents.findFirst({
    where: eq(messageStatusEvents.providerMessageId, event.providerMessageId),
  })

  // Allow multiple status events per message (queued → sent → delivered) but skip
  // exact duplicates where the status is unchanged and already processed.
  const isExactDuplicate = alreadyRecorded && alreadyRecorded.status === event.status
  if (!isExactDuplicate) {
    await db.insert(messageStatusEvents).values({
      messageId: message.id,
      providerMessageId: event.providerMessageId,
      status: event.status,
      rawPayload: event as unknown as Record<string, unknown>,
    })
  }

  // Only update the message row if it moves the status forward.
  // Ignore stale events that would move status backward (e.g. 'sent' after 'delivered').
  const STATUS_ORDER: Record<string, number> = {
    queued: 0, sent: 1, delivered: 2, failed: 2, received: 2,
  }
  const currentRank = STATUS_ORDER[message.status] ?? 0
  const incomingRank = STATUS_ORDER[event.status] ?? 0

  if (incomingRank < currentRank) {
    console.warn(
      `[messaging/status] Ignoring stale status '${event.status}' for message ${message.id} (current: '${message.status}')`
    )
    return
  }

  const updates: Partial<typeof messages.$inferInsert> = { status: event.status }
  if (event.status === 'delivered') updates.deliveredAt = event.occurredAt

  if (event.status === 'failed') {
    console.warn(
      `[messaging/status] Delivery failed for message ${message.id}` +
      (event.failureReason ? `: ${event.failureReason}` : '')
    )
    // NOTE: Delivery failure ≠ send failure. The workflow step already executed
    // (we sent the request to Telnyx successfully). The failure is at the carrier
    // level. We log it here for operator visibility. The step execution is already
    // marked 'executed'. Step-level retries (Telnyx send errors) are handled
    // in executor.ts → handleStepError, not here.

    if (isInvalidDestinationFailure(event.failureReason)) {
      await haltLeadForInvalidDestination(message.conversationId, event.failureReason ?? 'invalid_destination')
    }
  }

  await db.update(messages).set(updates).where(eq(messages.id, message.id))
}

// On a confirmed invalid-destination failure, mark the lead so no further
// automation runs against the bad phone:
//   • set lead.doNotAutomate = true (send-guard hard-stops)
//   • cancel any active enrollments
//   • transition lead → dead with the failure reason for audit
async function haltLeadForInvalidDestination(
  conversationId: string,
  failureReason: string,
): Promise<void> {
  const conv = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
    columns: { leadId: true },
  })
  if (!conv) return

  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, conv.leadId),
    columns: { id: true, state: true, doNotAutomate: true },
  })
  if (!lead) return

  if (!lead.doNotAutomate) {
    await db
      .update(leads)
      .set({ doNotAutomate: true, updatedAt: new Date() })
      .where(eq(leads.id, lead.id))
  }

  await db
    .update(workflowEnrollments)
    .set({
      status: 'cancelled',
      completedAt: new Date(),
      stopReason: 'invalid_destination',
      stoppedAt: new Date(),
    })
    .where(and(
      eq(workflowEnrollments.leadId, lead.id),
      eq(workflowEnrollments.status, 'active'),
    ))

  if (lead.state !== 'dead' && lead.state !== 'opted_out') {
    try {
      await transition(lead.id, 'dead', {
        reason: `Invalid destination: ${failureReason}`,
      })
    } catch (err) {
      console.warn(
        `[messaging/status] state transition to dead failed for lead ${lead.id}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }
}
