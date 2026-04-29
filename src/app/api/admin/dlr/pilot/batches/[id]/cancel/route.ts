/**
 * POST /api/admin/dlr/pilot/batches/:id/cancel
 *
 * Cancels a batch — no further sends will happen for any lead.
 * Cancels all non-completed enrollments so the executor will not run
 * any pending steps.
 *
 * Body (optional): { reason?: string }
 *
 * Terminal state — cannot be undone.
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { requireAuth } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { pilotBatchLeads, pilotBatches, workflowEnrollments } from '@/lib/db/schema'

const CANCELLABLE_STATUSES = ['draft', 'previewed', 'approved', 'sending', 'paused']

export async function POST(
  req: NextRequest,
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

  if (!CANCELLABLE_STATUSES.includes(batch.status)) {
    return NextResponse.json(
      { error: `Batch is already ${batch.status} — cannot cancel` },
      { status: 422 }
    )
  }

  const body = await req.json().catch(() => ({})) as { reason?: string }
  const reason = body.reason?.trim() || 'Manual cancellation'
  const now = new Date()

  // Cancel all active/paused enrollments
  const enrollmentIds = batch.leads
    .map(l => l.enrollmentId)
    .filter(Boolean) as string[]

  if (enrollmentIds.length > 0) {
    await db
      .update(workflowEnrollments)
      .set({
        status: 'cancelled',
        stopReason: `pilot_batch_cancelled: ${reason}`,
        stoppedAt: now,
      })
      .where(and(
        inArray(workflowEnrollments.id, enrollmentIds),
        inArray(workflowEnrollments.status, ['active', 'paused'])
      ))
  }

  // Mark all pending leads as cancelled
  await db
    .update(pilotBatchLeads)
    .set({
      sendStatus: 'cancelled',
      skipReason: `batch_cancelled: ${reason}`,
      updatedAt: now,
    })
    .where(and(
      eq(pilotBatchLeads.batchId, params.id),
      eq(pilotBatchLeads.sendStatus, 'pending')
    ))

  await db
    .update(pilotBatches)
    .set({
      status: 'cancelled',
      cancelledAt: now,
      cancelReason: reason,
      updatedAt: now,
    })
    .where(eq(pilotBatches.id, params.id))

  return NextResponse.json({
    success: true,
    status: 'cancelled',
    cancelReason: reason,
    enrollmentsCancelled: enrollmentIds.length,
  })
}
