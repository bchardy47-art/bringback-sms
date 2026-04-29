/**
 * POST /api/admin/dlr/pilot/batches/:id/start
 *
 * Starts the pilot batch — creates workflow enrollments for all approved
 * eligible leads and advances status to 'sending'.
 *
 * Requirements (all must pass):
 *   1. Batch in 'approved' or 'paused' (resume) status
 *   2. Full preflight readiness passes (Phase 8 gates)
 *   3. At least one lead with approvedForSend=true and sendStatus='pending'
 *
 * On success:
 *   - Creates workflowEnrollments for pending approved leads
 *   - Updates pilot_batch_leads.enrollmentId
 *   - Sets batch.status = 'sending'
 *   - Sets batch.startedAt (on first start)
 *
 * The existing workflow executor picks up the enrollments and runs steps
 * through the normal send-guard pipeline.
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { pilotBatchLeads, pilotBatches, workflowEnrollments } from '@/lib/db/schema'
import { runPreflight } from '@/lib/engine/preflight'

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

  // ── Gate 1: status check ───────────────────────────────────────────────────
  if (!['approved', 'paused'].includes(batch.status)) {
    return NextResponse.json(
      {
        error: `Cannot start a batch in status "${batch.status}"`,
        detail: batch.status === 'draft'
          ? 'Run /preview then /approve first'
          : batch.status === 'previewed'
            ? 'Run /approve first'
            : `Batch is already ${batch.status}`,
      },
      { status: 422 }
    )
  }

  // ── Gate 2: Phase 8 preflight ─────────────────────────────────────────────
  const preflight = await runPreflight(session.user.tenantId, batch.workflowId)
  if (!preflight.allowed) {
    return NextResponse.json(
      {
        error: 'Preflight readiness checks failed — cannot start pilot batch',
        preflight,
        blockers: preflight.failedBlockers.map(c => ({ id: c.id, label: c.label, detail: c.detail })),
      },
      { status: 422 }
    )
  }

  // ── Gate 3: eligible leads with pending send status ───────────────────────
  const pendingLeads = batch.leads.filter(
    l => l.approvedForSend && l.sendStatus === 'pending' && !l.enrollmentId
  )
  if (pendingLeads.length === 0) {
    return NextResponse.json(
      { error: 'No pending approved leads to enroll — batch may already be complete' },
      { status: 422 }
    )
  }

  // ── Create enrollments ─────────────────────────────────────────────────────
  const now = new Date()
  const enrollmentValues = pendingLeads.map(() => ({
    workflowId: batch.workflowId,
    leadId: '',        // filled below
    status: 'active' as const,
    currentStepPosition: 0,
    enrolledAt: now,
  }))

  // Insert enrollments one by one so we can capture each ID
  const createdEnrollments: Array<{ id: string; leadId: string }> = []
  for (const batchLead of pendingLeads) {
    const [enrollment] = await db
      .insert(workflowEnrollments)
      .values({
        workflowId: batch.workflowId,
        leadId: batchLead.leadId,
        status: 'active',
        currentStepPosition: 0,
        enrolledAt: now,
      })
      .returning()

    createdEnrollments.push({ id: enrollment.id, leadId: batchLead.leadId })

    // Link enrollment back to pilot_batch_lead
    await db
      .update(pilotBatchLeads)
      .set({ enrollmentId: enrollment.id, updatedAt: now })
      .where(eq(pilotBatchLeads.id, batchLead.id))
  }

  // ── Advance batch status ───────────────────────────────────────────────────
  await db
    .update(pilotBatches)
    .set({
      status: 'sending',
      startedAt: batch.startedAt ?? now,  // preserve original startedAt on resume
      updatedAt: now,
    })
    .where(eq(pilotBatches.id, params.id))

  return NextResponse.json({
    success: true,
    status: 'sending',
    enrollmentsCreated: createdEnrollments.length,
    enrollmentIds: createdEnrollments.map(e => e.id),
  })
}
