/**
 * POST /api/admin/dlr/pilot/batches/:id/smoke-test/verify
 *
 * Verifies the smoke test result:
 *   - Checks that a message audit row was created for the smoke test lead
 *   - Checks that a providerMessageId is set (Telnyx responded)
 *
 * On pass  → firstPilotState = 'smoke_test_passed'
 * On fail  → firstPilotState = 'smoke_test_failed', batch status = 'paused'
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { requireAdmin } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { pilotBatches } from '@/lib/db/schema'
import { verifySmokeTest } from '@/lib/pilot/first-pilot'

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

  const result = await verifySmokeTest(params.id)

  if (result.error && result.state !== 'smoke_test_failed') {
    return NextResponse.json({ error: result.error, state: result.state }, { status: 422 })
  }

  return NextResponse.json({
    ok: true,
    passed: result.passed,
    auditRowFound: result.auditRowFound,
    providerIdFound: result.providerIdFound,
    state: result.state,
    message: result.passed
      ? 'Smoke test passed — call /remaining to send the rest of the batch'
      : `Smoke test failed — batch has been paused`,
  })
}
