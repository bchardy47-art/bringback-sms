/**
 * POST /api/admin/dlr/pilot/batches/:id/preview
 *
 * Runs a dry-run preview of the batch:
 *   - Checks eligibility for every lead
 *   - Renders all workflow message templates against real lead data
 *   - Stores results in pilot_batch_leads + pilot_batches.dry_run_summary
 *   - Advances batch status to 'previewed'
 *
 * No enrollments are created. No messages are sent. Safe to call repeatedly.
 * Blocked if batch is already sending/completed/cancelled.
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { pilotBatches } from '@/lib/db/schema'
import { runBatchPreview } from '@/lib/pilot/preview'

const TERMINAL_STATUSES = ['sending', 'completed', 'cancelled']

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
  })
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  if (TERMINAL_STATUSES.includes(batch.status)) {
    return NextResponse.json(
      { error: `Cannot preview a batch in status "${batch.status}"` },
      { status: 422 }
    )
  }

  const result = await runBatchPreview(params.id)

  return NextResponse.json({
    success: true,
    batchId: params.id,
    status: 'previewed',
    eligibleCount: result.eligibleCount,
    ineligibleCount: result.ineligibleCount,
    summary: result.summary,
  })
}
