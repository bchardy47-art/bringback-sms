/**
 * POST /api/admin/dlr/pilot/batches/:id/pause
 *
 * Pauses a sending batch. Pauses all active enrollments so the send
 * guard's workflow_paused check will block any pending step executions.
 * The batch can be resumed by calling /start again.
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { requireAuth } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { pilotBatchLeads, pilotBatches, workflowEnrollments } from '@/lib/db/schema'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const batch = await db.query.pilotBatches.findFirst({
    where: and(
      eq(pilotBatches.id, params.id),
      eq(pilotBatches.tenantId, session.user.tenantId)
    ),
    with: { leads: true },
  })
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  if (batch.status !== 'sending') {
    return NextResponse.json(
      { error: `Cannot pause a batch in status "${batch.status}" — only 'sending' batches can be paused` },
      { status: 422 }
    )
  }

  const now = new Date()

  // Pause all active enrollments belonging to this batch
  const enrollmentIds = batch.leads
    .map(l => l.enrollmentId)
    .filter(Boolean) as string[]

  if (enrollmentIds.length > 0) {
    await db
      .update(workflowEnrollments)
      .set({ status: 'paused' })
      .where(and(
        inArray(workflowEnrollments.id, enrollmentIds),
        eq(workflowEnrollments.status, 'active')
      ))
  }

  await db
    .update(pilotBatches)
    .set({ status: 'paused', updatedAt: now })
    .where(eq(pilotBatches.id, params.id))

  return NextResponse.json({
    success: true,
    status: 'paused',
    enrollmentsPaused: enrollmentIds.length,
    message: 'Batch paused. Existing enrollments preserved. Call /start to resume.',
  })
}
