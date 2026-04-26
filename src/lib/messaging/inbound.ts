import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { conversations, leads, messages, phoneNumbers } from '@/lib/db/schema'
import type { InboundMessage } from './provider.interface'
import { isOptedOut, isStopMessage, isUnstopMessage, recordOptOut, removeOptOut } from './opt-out'
import { transition } from '@/lib/lead/state-machine'

export async function handleInbound(msg: InboundMessage): Promise<void> {
  // ── Idempotency guard ────────────────────────────────────────────────────
  // Telnyx retries webhooks on timeout. A duplicate providerMessageId means
  // we've already processed this message — skip entirely.
  const existing = await db.query.messages.findFirst({
    where: eq(messages.providerMessageId, msg.providerMessageId),
  })
  if (existing) {
    console.warn(`[inbound] Duplicate providerMessageId ${msg.providerMessageId} — skipping`)
    return
  }

  // ── Tenant resolution ─────────────────────────────────────────────────────
  const phoneNumber = await db.query.phoneNumbers.findFirst({
    where: eq(phoneNumbers.number, msg.to),
  })
  if (!phoneNumber) {
    console.warn(`[inbound] SMS to unknown number ${msg.to} — ignoring`)
    return
  }
  const tenantId = phoneNumber.tenantId

  // ── STOP ─────────────────────────────────────────────────────────────────
  if (isStopMessage(msg.body)) {
    await recordOptOut(tenantId, msg.from)

    const conv = await db.query.conversations.findFirst({
      where: and(eq(conversations.tenantId, tenantId), eq(conversations.leadPhone, msg.from)),
    })
    if (conv) {
      await db
        .update(conversations)
        .set({ status: 'opted_out', updatedAt: new Date() })
        .where(eq(conversations.id, conv.id))
      // Guard: transition only if the state machine allows it
      const lead = await db.query.leads.findFirst({ where: eq(leads.id, conv.leadId) })
      if (lead && lead.state !== 'opted_out' && lead.state !== 'dead') {
        await transition(conv.leadId, 'opted_out', { reason: 'Inbound STOP' })
      }
    }

    // Log the STOP message itself for operator audit trail
    if (conv) {
      await db.insert(messages).values({
        conversationId: conv.id,
        direction: 'inbound',
        body: msg.body,
        provider: 'telnyx',
        providerMessageId: msg.providerMessageId,
        status: 'received',
      })
    }
    return
  }

  // ── UNSTOP ───────────────────────────────────────────────────────────────
  if (isUnstopMessage(msg.body)) {
    await removeOptOut(tenantId, msg.from)

    const conv = await db.query.conversations.findFirst({
      where: and(eq(conversations.tenantId, tenantId), eq(conversations.leadPhone, msg.from)),
    })
    if (conv) {
      await db
        .update(conversations)
        .set({ status: 'open', updatedAt: new Date() })
        .where(eq(conversations.id, conv.id))

      const lead = await db.query.leads.findFirst({ where: eq(leads.id, conv.leadId) })
      if (lead && lead.state === 'opted_out') {
        await transition(conv.leadId, 'active', { reason: 'Inbound UNSTOP' })
      }

      await db.insert(messages).values({
        conversationId: conv.id,
        direction: 'inbound',
        body: msg.body,
        provider: 'telnyx',
        providerMessageId: msg.providerMessageId,
        status: 'received',
      })
    }
    return
  }

  // ── Regular reply ─────────────────────────────────────────────────────────
  // Find or create conversation. Use ON CONFLICT to handle concurrent inbound
  // messages for a lead that has no conversation yet.
  let conversation = await db.query.conversations.findFirst({
    where: and(eq(conversations.tenantId, tenantId), eq(conversations.leadPhone, msg.from)),
  })

  if (!conversation) {
    const lead = await db.query.leads.findFirst({
      where: and(eq(leads.tenantId, tenantId), eq(leads.phone, msg.from)),
    })
    if (!lead) {
      console.warn(`[inbound] Reply from unknown number ${msg.from} on tenant ${tenantId}`)
      return
    }

    const [created] = await db
      .insert(conversations)
      .values({ tenantId, leadId: lead.id, tenantPhone: msg.to, leadPhone: msg.from })
      .onConflictDoUpdate({
        target: conversations.leadId,
        set: { updatedAt: new Date() },
      })
      .returning()
    conversation = created
  }

  // Log the inbound message — always, even for opted-out numbers (audit trail)
  await db.insert(messages).values({
    conversationId: conversation.id,
    direction: 'inbound',
    body: msg.body,
    mediaUrls: msg.mediaUrls ?? [],
    provider: 'telnyx',
    providerMessageId: msg.providerMessageId,
    status: 'received',
  })

  // Do not reopen a conversation for an opted-out number.
  // Non-STOP inbounds from opted-out leads are logged above for the audit trail
  // but must not flip the conversation back to 'open' or trigger a state transition.
  if (await isOptedOut(tenantId, msg.from)) {
    console.log(`[inbound] Opted-out number ${msg.from} sent non-STOP message — logged, conversation status unchanged`)
    return
  }

  // Bump conversation to open + update timestamp
  await db
    .update(conversations)
    .set({ status: 'open', updatedAt: new Date() })
    .where(eq(conversations.id, conversation.id))

  // Transition lead to 'responded' if currently enrolled.
  // If already responded/revived, the state machine will no-op (idempotent).
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, conversation.leadId) })
  if (lead && lead.state === 'enrolled') {
    await transition(lead.id, 'responded', { reason: 'Replied to outreach' })
  }
}
