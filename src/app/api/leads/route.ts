import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { leads } from '@/lib/db/schema'
import { requireAuth } from '@/lib/api/requireAuth'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const { searchParams } = new URL(req.url)
  const state = searchParams.get('state')
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '50'))
  const offset = (page - 1) * limit

  const conditions = [eq(leads.tenantId, session.user.tenantId)]
  if (state) {
    const states = state.split(',').filter(Boolean)
    if (states.length === 1) {
      conditions.push(eq(leads.state, states[0] as typeof leads.state._.data))
    } else if (states.length > 1) {
      conditions.push(inArray(leads.state, states as typeof leads.state._.data[]))
    }
  }

  const rows = await db.query.leads.findMany({
    where: and(...conditions),
    orderBy: [desc(leads.updatedAt)],
    limit,
    offset,
  })

  return NextResponse.json({ leads: rows, page, limit })
}

const CreateLeadSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().min(10),
  email: z.string().email().optional(),
  vehicleOfInterest: z.string().optional(),
  salespersonName: z.string().optional(),
  crmLeadId: z.string().optional(),
  lastCrmActivityAt: z.string().datetime().optional(),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const body = await req.json()
  const parsed = CreateLeadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const [lead] = await db
    .insert(leads)
    .values({
      tenantId: session.user.tenantId,
      ...parsed.data,
      lastCrmActivityAt: parsed.data.lastCrmActivityAt
        ? new Date(parsed.data.lastCrmActivityAt)
        : null,
    })
    .returning()

  return NextResponse.json({ lead }, { status: 201 })
}
