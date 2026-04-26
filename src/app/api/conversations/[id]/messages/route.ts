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

  const outcome = await sendMessage({
    tenantId: session.user.tenantId,
    leadId: conversation.leadId,
    to: conversation.leadPhone,
    body: parsed.data.body,
  })

  if (outcome.skipped === 'opted_out') {
    return NextResponse.json({ error: 'Lead has opted out' }, { status: 409 })
  }

  return NextResponse.json({ messageId: outcome.messageId }, { status: 201 })
}
