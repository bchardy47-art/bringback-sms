/**
 * POST /api/admin/dlr/workflows/:id/approve
 *
 * Marks a workflow's message copy as approved for live sends.
 * Advances activationStatus to 'approved' and sets approvedForLive=true.
 *
 * Blocked if:
 *   - workflow.requiresOptOutLanguage=true but first step lacks opt-out copy
 *
 * Body (optional): { reviewedBy?: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { workflows, workflowSteps } from '@/lib/db/schema'
import type { SendSmsConfig } from '@/lib/db/schema'

function hasOptOutLanguage(body: string): boolean {
  return /\bSTOP\b/i.test(body) || /opt.?out/i.test(body)
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  // Load workflow + first step
  const workflow = await db.query.workflows.findFirst({
    where: and(
      eq(workflows.id, params.id),
      eq(workflows.tenantId, session.user.tenantId)
    ),
    with: { steps: { orderBy: [workflowSteps.position] } },
  })

  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  // Enforce opt-out language check
  if (workflow.requiresOptOutLanguage) {
    const sendSteps = workflow.steps.filter(s => s.type === 'send_sms')
    const firstSend = sendSteps[0]
    if (!firstSend) {
      return NextResponse.json(
        { error: 'Workflow has no send_sms steps — cannot approve' },
        { status: 422 }
      )
    }
    const config = firstSend.config as SendSmsConfig
    if (!hasOptOutLanguage(config.template)) {
      return NextResponse.json(
        {
          error: 'First message does not contain opt-out language',
          detail: 'Add "Reply STOP to opt out" or equivalent to the first send_sms step template',
          template: config.template.slice(0, 120),
        },
        { status: 422 }
      )
    }
  }

  const body = await req.json().catch(() => ({})) as { reviewedBy?: string }
  const approvedBy = body.reviewedBy ?? session.user.email ?? session.user.id
  const now = new Date()

  await db
    .update(workflows)
    .set({
      approvedForLive: true,
      approvedAt: now,
      approvedBy,
      activationStatus: 'approved',
      updatedAt: now,
    })
    .where(eq(workflows.id, params.id))

  return NextResponse.json({
    success: true,
    approvedForLive: true,
    approvedAt: now.toISOString(),
    approvedBy,
    activationStatus: 'approved',
  })
}
