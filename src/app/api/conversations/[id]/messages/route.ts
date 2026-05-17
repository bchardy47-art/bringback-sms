import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { conversations } from '@/lib/db/schema'
import { requireAuth } from '@/lib/api/requireAuth'
import { sendMessage } from '@/lib/messaging/send'

const SendSchema = z.object({
  body: z.string().min(1).max(1600),
})

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, params.id),
      eq(conversations.tenantId, session.user.tenantId)
    ),
  })
  if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (conversation.status === 'opted_out') {
    return NextResponse.json({ error: 'Lead has opted out' }, { status: 409 })
  }

  const body = await req.json()
  const parsed = SendSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  let outcome
  try {
    outcome = await sendMessage({
      tenantId: session.user.tenantId,
      leadId: conversation.leadId,
      to: conversation.leadPhone,
      body: parsed.data.body,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Tenant has no row in phone_numbers. The composer should surface a
    // remediation message rather than a generic 500.
    if (msg.startsWith('No active phone number for tenant')) {
      return NextResponse.json(
        { error: 'This account has no SMS number assigned. Contact ops to provision one before sending.' },
        { status: 409 },
      )
    }
    console.error('[api/conversations/messages] send failed:', err)
    return NextResponse.json({ error: 'Failed to send message. Please try again.' }, { status: 500 })
  }

  if (outcome.skipped === 'opted_out') {
    return NextResponse.json({ error: 'Lead has opted out' }, { status: 409 })
  }

  return NextResponse.json({ messageId: outcome.messageId }, { status: 201 })
}
