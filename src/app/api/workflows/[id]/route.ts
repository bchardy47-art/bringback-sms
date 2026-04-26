import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { workflows } from '@/lib/db/schema'
import { requireAuth } from '@/lib/api/requireAuth'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const workflow = await db.query.workflows.findFirst({
    where: and(eq(workflows.id, params.id), eq(workflows.tenantId, session.user.tenantId)),
    with: {
      steps: { orderBy: (s, { asc }) => [asc(s.position)] },
      enrollments: {
        orderBy: (e, { desc }) => [desc(e.enrolledAt)],
        limit: 100,
        with: { lead: { columns: { id: true, firstName: true, lastName: true, state: true } } },
      },
    },
  })

  if (!workflow) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ workflow })
}

const UpdateWorkflowSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const workflow = await db.query.workflows.findFirst({
    where: and(eq(workflows.id, params.id), eq(workflows.tenantId, session.user.tenantId)),
  })
  if (!workflow) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = UpdateWorkflowSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const [updated] = await db
    .update(workflows)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(workflows.id, params.id))
    .returning()

  return NextResponse.json({ workflow: updated })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const workflow = await db.query.workflows.findFirst({
    where: and(eq(workflows.id, params.id), eq(workflows.tenantId, session.user.tenantId)),
  })
  if (!workflow) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Soft-delete by deactivating rather than hard delete, to preserve enrollment history
  await db
    .update(workflows)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(workflows.id, params.id))

  return NextResponse.json({ ok: true })
}
