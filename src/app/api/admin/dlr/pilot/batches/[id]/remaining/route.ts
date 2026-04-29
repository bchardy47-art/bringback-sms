/**
 * POST /api/admin/dlr/pilot/batches/:id/remaining
 *
 * Enrolls all remaining approved leads after the smoke test passes.
 *
 * Blocked if:
 *   - firstPilotState is not 'smoke_test_passed' or 'ready_for_remaining'
 *   - continuationRequired is set (STOP or complaint — needs manual confirmation)
 *   - batch is paused or cancelled
 */

import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { pilotBatches } from '@/lib/db/schema'
import { startRemainingLeads } from '@/lib/pilot/first-pilot'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const batch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, params.id),
  })
  if (!batch || batch.tenantId !== session.user.tenantId) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  }

  const result = await startRemainingLeads(params.id)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 422 })
  }

  return NextResponse.json({
    ok: true,
    enrolledCount: result.enrolledCount,
    message: result.enrolledCount === 0
      ? 'No remaining leads — batch is now complete'
      : `${result.enrolledCount} lead(s) enrolled for send`,
  })
}
