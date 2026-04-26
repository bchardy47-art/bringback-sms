import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { leads } from '@/lib/db/schema'
import { requireAuth } from '@/lib/api/requireAuth'
import { transition, type LeadState } from '@/lib/lead/state-machine'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, params.id), eq(leads.tenantId, session.user.tenantId)),
    with: {
      stateHistory: { orderBy: (h, { desc }) => [desc(h.createdAt)] },
      conversation: { with: { messages: { orderBy: (m, { asc }) => [asc(m.createdAt)], limit: 50 } } },
      enrollments: { with: { workflow: true } },
    },
  })

  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ lead })
}

const UpdateLeadSchema = z.object({
  state: z.enum(['active', 'stale', 'orphaned', 'enrolled', 'responded', 'revived', 'exhausted', 'converted', 'opted_out', 'dead']).optional(),
  salespersonName: z.string().optional(),
  vehicleOfInterest: z.string().optional(),
  notes: z.string().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, params.id), eq(leads.tenantId, session.user.tenantId)),
  })
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = UpdateLeadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const { state, ...rest } = parsed.data

  // State change goes through state machine to maintain history
  if (state && state !== lead.state) {
    await transition(lead.id, state as LeadState, {
      reason: 'Manual update',
      actor: `user:${session.user.id}`,
    })
  }

  // Other field updates
  if (Object.keys(rest).length > 0) {
    await db
      .update(leads)
      .set({ ...rest, updatedAt: new Date() })
      .where(eq(leads.id, lead.id))
  }

  const updated = await db.query.leads.findFirst({ where: eq(leads.id, lead.id) })
  return NextResponse.json({ lead: updated })
}
