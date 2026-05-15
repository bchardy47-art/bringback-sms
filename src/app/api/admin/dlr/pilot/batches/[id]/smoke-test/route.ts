/**
 * POST /api/admin/dlr/pilot/batches/:id/smoke-test
 *
 * Starts the first-pilot smoke test — enrolls exactly ONE lead and advances
 * the batch to 'smoke_test_sending'.
 *
 * Requirements:
 *   - Batch must be isFirstPilot = true
 *   - Batch status must be 'approved'
 *   - firstPilotState must be 'not_started' or 'ready_for_smoke_test'
 *   - Lead count must not exceed FIRST_PILOT_CAP (5)
 *   - All Phase 8 readiness checks must pass
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { requireAdmin } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { pilotBatches } from '@/lib/db/schema'
import { validateFirstPilotReadiness, startSmokeTest } from '@/lib/pilot/first-pilot'

export async function POST(
  _req: NextRequest,
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

  // Validate all readiness preconditions
  const { ready, checks, blockers } = await validateFirstPilotReadiness(params.id)
  if (!ready) {
    return NextResponse.json(
      {
        error: 'First pilot readiness checks failed',
        blockers,
        checks,
      },
      { status: 422 }
    )
  }

  // Start the smoke test
  const result = await startSmokeTest(params.id)
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 422 })
  }

  return NextResponse.json({
    ok: true,
    smokeTestLeadId: result.smokeTestLeadId,
    message: 'Smoke test started — one lead enrolled. Wait for the message to send, then call /verify.',
  })
}
