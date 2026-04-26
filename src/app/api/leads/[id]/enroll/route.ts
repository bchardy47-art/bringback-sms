import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { leads, workflows } from '@/lib/db/schema'
import { requireAuth } from '@/lib/api/requireAuth'
import { enrollLead } from '@/lib/engine/enroll'

const EnrollSchema = z.object({
  workflowId: z.string().uuid(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  // Verify lead belongs to tenant
  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, params.id), eq(leads.tenantId, session.user.tenantId)),
  })
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = EnrollSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  // Verify workflow belongs to tenant
  const workflow = await db.query.workflows.findFirst({
    where: and(
      eq(workflows.id, parsed.data.workflowId),
      eq(workflows.tenantId, session.user.tenantId)
    ),
  })
  if (!workflow) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })

  const result = await enrollLead(lead.id, workflow.id)

  if ('skipped' in result) {
    return NextResponse.json({ skipped: result.skipped }, { status: 409 })
  }

  return NextResponse.json({ enrollmentId: result.enrollmentId }, { status: 201 })
}
