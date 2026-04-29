/**
 * POST /api/admin/dlr/workflows/:id/activate
 *
 * Activates a workflow for lead enrollment.
 *
 * Runs the full preflight check before allowing activation.
 * Blocked if any blocker check fails — the response includes the full
 * preflight result so the UI can surface exactly which checks need attention.
 *
 * On success:
 *   - workflow.isActive = true
 *   - workflow.activationStatus = 'active'
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { workflows } from '@/lib/db/schema'
import { runPreflight } from '@/lib/engine/preflight'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  // Verify workflow belongs to this tenant
  const workflow = await db.query.workflows.findFirst({
    where: and(
      eq(workflows.id, params.id),
      eq(workflows.tenantId, session.user.tenantId)
    ),
  })
  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  // Run full preflight — temporarily treat workflow as if it were active
  // so we can evaluate all other checks. We check isActive separately below.
  const preflight = await runPreflight(session.user.tenantId, params.id)

  // Filter out workflow_active from blockers (it's false because we haven't activated yet)
  const hardBlockers = preflight.failedBlockers.filter(c => c.id !== 'workflow_active')

  if (hardBlockers.length > 0) {
    return NextResponse.json(
      {
        error: 'Preflight checks failed — cannot activate workflow',
        preflight,
        blockers: hardBlockers.map(c => ({ id: c.id, label: c.label, detail: c.detail })),
      },
      { status: 422 }
    )
  }

  // All checks pass — activate
  const now = new Date()
  await db
    .update(workflows)
    .set({
      isActive: true,
      activationStatus: 'active',
      updatedAt: now,
    })
    .where(eq(workflows.id, params.id))

  return NextResponse.json({
    success: true,
    isActive: true,
    activationStatus: 'active',
    preflight: { ...preflight, summary: 'Workflow activated — all checks passed' },
  })
}
