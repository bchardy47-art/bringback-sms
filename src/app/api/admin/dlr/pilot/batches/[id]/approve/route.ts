/**
 * POST /api/admin/dlr/pilot/batches/:id/approve
 *
 * Marks a previewed batch as approved for live sends.
 *
 * Requirements:
 *   - Batch must be in 'previewed' status (preview must run first)
 *   - At least one eligible lead must be present
 *
 * Body (optional): { approvedBy?: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { pilotBatchLeads, pilotBatches } from '@/lib/db/schema'

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

  if (batch.status !== 'previewed') {
    return NextResponse.json(
      {
        error: `Cannot approve a batch in status "${batch.status}"`,
        detail: batch.status === 'draft'
          ? 'Run /preview first before approving'
          : `Batch is already ${batch.status}`,
      },
      { status: 422 }
    )
  }

  const eligibleLeads = batch.leads.filter(l => l.eligibilityResult?.eligible)
  if (eligibleLeads.length === 0) {
    return NextResponse.json(
      { error: 'No eligible leads in this batch — cannot approve' },
      { status: 422 }
    )
  }

  const body = await req.json().catch(() => ({})) as { approvedBy?: string }
  const approvedBy = body.approvedBy ?? session.user.email ?? session.user.id
  const now = new Date()

  await db
    .update(pilotBatches)
    .set({
      status: 'approved',
      approvedBy,
      approvedAt: now,
      updatedAt: now,
    })
    .where(eq(pilotBatches.id, params.id))

  return NextResponse.json({
    success: true,
    status: 'approved',
    approvedBy,
    approvedAt: now.toISOString(),
    eligibleLeadCount: eligibleLeads.length,
  })
}
