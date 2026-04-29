/**
 * POST /api/admin/dlr/workflows/:id/pause
 *
 * Pauses an active workflow. Sets isActive=false and activationStatus='paused'.
 * Does not cancel existing enrollments — the send guard's workflow_paused
 * check will block any pending step executions until the workflow is re-activated.
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { workflows } from '@/lib/db/schema'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const workflow = await db.query.workflows.findFirst({
    where: and(
      eq(workflows.id, params.id),
      eq(workflows.tenantId, session.user.tenantId)
    ),
  })
  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  await db
    .update(workflows)
    .set({
      isActive: false,
      activationStatus: 'paused',
      updatedAt: new Date(),
    })
    .where(eq(workflows.id, params.id))

  return NextResponse.json({
    success: true,
    isActive: false,
    activationStatus: 'paused',
    message: 'Workflow paused. Existing enrollments are preserved but no new messages will be sent.',
  })
}
