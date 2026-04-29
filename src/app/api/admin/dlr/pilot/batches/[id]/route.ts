/**
 * GET /api/admin/dlr/pilot/batches/:id
 *
 * Returns the full batch with all leads, their eligibility results,
 * and rendered message previews.
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { pilotBatches, workflowSteps } from '@/lib/db/schema'

export async function GET(
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
    with: {
      leads: { with: { lead: true } },
      workflow: { with: { steps: { orderBy: [workflowSteps.position] } } },
    },
  })

  if (!batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  }

  return NextResponse.json({ batch })
}
