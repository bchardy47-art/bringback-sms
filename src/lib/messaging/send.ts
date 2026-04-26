import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { conversations, messages, phoneNumbers } from '@/lib/db/schema'
import { getProvider } from './index'
import { isOptedOut } from './opt-out'

interface SendParams {
  tenantId: string
  leadId: string
  to: string      // lead phone E.164
  body: string
  workflowStepId?: string
}

interface SendOutcome {
  messageId: string
  skipped?: 'opted_out'
}

export async function sendMessage(params: SendParams): Promise<SendOutcome> {
  const { tenantId, leadId, to, body, workflowStepId } = params

  // Hard stop: never send to opted-out numbers
  if (await isOptedOut(tenantId, to)) {
    return { messageId: '', skipped: 'opted_out' }
  }

  // Get the active phone number for this tenant
  const phoneNumber = await db.query.phoneNumbers.findFirst({
    where: eq(phoneNumbers.tenantId, tenantId),
  })
  if (!phoneNumber) throw new Error(`No active phone number for tenant ${tenantId}`)

  // Upsert conversation — ON CONFLICT handles concurrent sends for the same lead
  // (e.g. worker step fires at the same time as a manual inbox send).
  // The unique constraint on conversations.leadId makes this safe.
  const [conversation] = await db
    .insert(conversations)
    .values({ tenantId, leadId, tenantPhone: phoneNumber.number, leadPhone: to })
    .onConflictDoUpdate({
      target: conversations.leadId,
      set: { updatedAt: new Date() },
    })
    .returning()

  // Insert message row as queued
  const [message] = await db
    .insert(messages)
    .values({
      conversationId: conversation.id,
      direction: 'outbound',
      body,
      status: 'queued',
      workflowStepId: workflowStepId ?? null,
    })
    .returning()

  // Send via provider
  try {
    const provider = getProvider()
    const result = await provider.send({ to, from: phoneNumber.number, body })

    await db
      .update(messages)
      .set({ providerMessageId: result.providerMessageId, status: 'sent', sentAt: new Date() })
      .where(eq(messages.id, message.id))

    // Update conversation updatedAt
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversation.id))

    return { messageId: message.id }
  } catch (err) {
    console.error(`[messaging/send] Failed to send message ${message.id}:`, err)
    await db
      .update(messages)
      .set({ status: 'failed' })
      .where(eq(messages.id, message.id))
    throw err
  }
}
