import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { messages, messageStatusEvents } from '@/lib/db/schema'
import type { StatusEvent } from './provider.interface'

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
  }

  await db.update(messages).set(updates).where(eq(messages.id, message.id))
}
