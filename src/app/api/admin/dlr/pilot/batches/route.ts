/**
 * POST /api/admin/dlr/pilot/batches  — create a new pilot batch
 * GET  /api/admin/dlr/pilot/batches  — list batches for this tenant
 *
 * POST body:
 * {
 *   workflowId: string        — UUID of workflow to pilot
 *   leadIds:    string[]      — explicit list of lead UUIDs (≤ maxLeadCount)
 *   maxLeadCount?: number     — hard cap (default 10, max HARD_PILOT_CAP=50)
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { requireAuth } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { leads, pilotBatchLeads, pilotBatches, workflows, HARD_PILOT_CAP } from '@/lib/db/schema'
import { runPreflight } from '@/lib/engine/preflight'

// ── POST ───────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const body = await req.json().catch(() => null) as {
    workflowId?: string
    leadIds?: string[]
    maxLeadCount?: number
  } | null

  if (!body?.workflowId || !Array.isArray(body.leadIds) || body.leadIds.length === 0) {
    return NextResponse.json(
      { error: 'workflowId and leadIds (non-empty array) are required' },
      { status: 400 }
    )
  }

  const maxLeadCount = Math.min(
    body.maxLeadCount ?? 10,
    HARD_PILOT_CAP
  )

  if (body.leadIds.length > maxLeadCount) {
    return NextResponse.json(
      {
        error: `Batch size ${body.leadIds.length} exceeds maxLeadCount ${maxLeadCount} (hard cap: ${HARD_PILOT_CAP})`,
        maxLeadCount,
        hardCap: HARD_PILOT_CAP,
      },
      { status: 422 }
    )
  }

  // Verify workflow exists and belongs to this tenant
  const workflow = await db.query.workflows.findFirst({
    where: and(
      eq(workflows.id, body.workflowId),
      eq(workflows.tenantId, session.user.tenantId)
    ),
  })
  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  // Verify all leads belong to this tenant
  const leadRows = await db.query.leads.findMany({
    where: and(
      inArray(leads.id, body.leadIds),
      eq(leads.tenantId, session.user.tenantId)
    ),
  })
  const foundLeadIds = new Set(leadRows.map(l => l.id))
  const missingLeads = body.leadIds.filter(id => !foundLeadIds.has(id))
  if (missingLeads.length > 0) {
    return NextResponse.json(
      { error: 'Some leads not found or do not belong to this tenant', missingLeads },
      { status: 404 }
    )
  }

  // Create batch + leads in a transaction
  const now = new Date()
  const [batch] = await db
    .insert(pilotBatches)
    .values({
      tenantId: session.user.tenantId,
      workflowId: body.workflowId,
      status: 'draft',
      maxLeadCount,
      createdBy: session.user.email ?? session.user.id,
      updatedAt: now,
    })
    .returning()

  await db.insert(pilotBatchLeads).values(
    body.leadIds.map(leadId => ({
      batchId: batch.id,
      leadId,
      sendStatus: 'pending' as const,
    }))
  )

  return NextResponse.json({ batch, leadCount: body.leadIds.length }, { status: 201 })
}

// ── GET ────────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const batches = await db.query.pilotBatches.findMany({
    where: eq(pilotBatches.tenantId, session.user.tenantId),
    with: { leads: true, workflow: true },
    orderBy: [desc(pilotBatches.createdAt)],
  })

  return NextResponse.json({
    batches: batches.map(b => ({
      ...b,
      leadCount: b.leads.length,
      eligibleCount: b.leads.filter(l => l.eligibilityResult?.eligible).length,
    })),
  })
}
