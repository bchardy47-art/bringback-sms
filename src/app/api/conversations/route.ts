import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { conversations } from '@/lib/db/schema'
import { requireAuth } from '@/lib/api/requireAuth'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') // 'open' | 'closed' | 'opted_out'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '50'))
  const offset = (page - 1) * limit

  const conditions = [eq(conversations.tenantId, session.user.tenantId)]
  if (status) {
    conditions.push(eq(conversations.status, status as typeof conversations.status._.data))
  }

  const rows = await db.query.conversations.findMany({
    where: and(...conditions),
    orderBy: [desc(conversations.updatedAt)],
    limit,
    offset,
    with: {
      lead: { columns: { id: true, firstName: true, lastName: true, phone: true, state: true } },
    },
  })

  return NextResponse.json({ conversations: rows, page, limit })
}
