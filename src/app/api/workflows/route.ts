import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { workflows, workflowSteps } from '@/lib/db/schema'
import { requireAuth } from '@/lib/api/requireAuth'
import type { StepConfig } from '@/lib/db/schema'

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const rows = await db.query.workflows.findMany({
    where: eq(workflows.tenantId, session.user.tenantId),
    with: { steps: { orderBy: (s, { asc }) => [asc(s.position)] } },
    orderBy: (w, { desc }) => [desc(w.createdAt)],
  })

  return NextResponse.json({ workflows: rows })
}

const StepSchema = z.object({
  position: z.number().int().positive(),
  type: z.enum(['send_sms', 'condition', 'assign']),
  config: z.record(z.unknown()),
})

const CreateWorkflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  triggerType: z.enum(['stale', 'orphaned', 'no_show', 'manual']),
  triggerConfig: z.object({ daysInactive: z.number().optional() }).optional(),
  steps: z.array(StepSchema).min(1),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const body = await req.json()
  const parsed = CreateWorkflowSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const { steps, ...workflowData } = parsed.data

  const workflow = await db.transaction(async (tx) => {
    const [wf] = await tx
      .insert(workflows)
      .values({ tenantId: session.user.tenantId, ...workflowData })
      .returning()

    await tx.insert(workflowSteps).values(
      steps.map((s) => ({
        workflowId: wf.id,
        position: s.position,
        type: s.type,
        config: s.config as StepConfig,
      }))
    )

    return wf
  })

  const full = await db.query.workflows.findFirst({
    where: eq(workflows.id, workflow.id),
    with: { steps: { orderBy: (s, { asc }) => [asc(s.position)] } },
  })

  return NextResponse.json({ workflow: full }, { status: 201 })
}
