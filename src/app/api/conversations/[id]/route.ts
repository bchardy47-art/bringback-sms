import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { conversations } from '@/lib/db/schema'
import { requireAuth } from '@/lib/api/requireAuth'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, params.id),
      eq(conversations.tenantId, session.user.tenantId)
    ),
    with: {
      lead: true,
      messages: { orderBy: (m, { asc }) => [asc(m.createdAt)] },
    },
  })

  if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ conversation })
}

export async function PATCH(
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

  const { status } = await req.json()
  if (!['open', 'closed', 'opted_out'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 422 })
  }

  await db
    .update(conversations)
    .set({ status, updatedAt: new Date() })
    .where(eq(conversations.id, params.id))

  return NextResponse.json({ ok: true })
}
