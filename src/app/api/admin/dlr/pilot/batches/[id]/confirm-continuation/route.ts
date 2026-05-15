/**
 * POST /api/admin/dlr/pilot/batches/:id/confirm-continuation
 *
 * Admin confirms they've reviewed the STOP or escalation complaint that
 * paused continuation of the pilot and explicitly want to proceed.
 * Clears the continuationRequired flag.
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { requireAdmin } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { pilotBatches } from '@/lib/db/schema'
import { confirmContinuation } from '@/lib/pilot/first-pilot'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAdmin()
  if (error) return error

  const batch = await db.query.pilotBatches.findFirst({
    where: and(eq(pilotBatches.id, params.id), eq(pilotBatches.tenantId, session.user.tenantId)),
    columns: { id: true },
  })
  if (!batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  }

  const result = await confirmContinuation(params.id, session.user.email ?? 'admin')

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 422 })
  }

  return NextResponse.json({
    ok: true,
    message: 'Continuation confirmed — you may now proceed with remaining sends',
  })
}
