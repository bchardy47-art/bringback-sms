/**
 * Phase 13 — Live Pilot Execution API
 *
 * GET  /api/admin/live-pilot/[batchId]              — Full live pilot status
 * POST /api/admin/live-pilot/[batchId]              — Execute an action
 *
 * POST body: { action: string, ...actionParams }
 *
 * Actions:
 *   confirm            — Submit confirmation gate
 *   start_smoke        — Start the smoke test (1 lead)
 *   verify_smoke       — Verify smoke test passed
 *   start_remaining    — Start remaining leads (2-5)
 *   pause              — Pause the batch
 *   cancel             — Cancel the batch
 *   confirm_continue   — Confirm continuation after a stop/complaint
 *   generate_report    — Generate/regenerate the pilot report
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { requireAdmin } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { pilotBatches } from '@/lib/db/schema'
import {
  getLivePilotStatus,
  validateConfirmationGate,
  submitConfirmation,
  liveStartSmokeTest,
  liveVerifySmokeTest,
  liveStartRemainingLeads,
  generatePilotReport,
} from '@/lib/pilot/live-pilot-execution'
import { confirmContinuation } from '@/lib/pilot/first-pilot'
import type { PilotConfirmationChecks } from '@/lib/db/schema'

type RouteContext = { params: { batchId: string } }

async function assertBatchInTenant(batchId: string, tenantId: string) {
  const batch = await db.query.pilotBatches.findFirst({
    where: and(eq(pilotBatches.id, batchId), eq(pilotBatches.tenantId, tenantId)),
    columns: { id: true },
  })
  return !!batch
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { session, error } = await requireAdmin()
  if (error) return error

  if (!(await assertBatchInTenant(params.batchId, session.user.tenantId))) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  }

  try {
    const status = await getLivePilotStatus(params.batchId)
    if (!status) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
    return NextResponse.json(status)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { session, error } = await requireAdmin()
  if (error) return error

  if (!(await assertBatchInTenant(params.batchId, session.user.tenantId))) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = body.action as string | undefined

  if (!action) {
    return NextResponse.json({ error: 'Missing action in request body' }, { status: 400 })
  }

  try {
    const batchId = params.batchId

    switch (action) {
      case 'confirm': {
        const phrase = body.phrase as string
        const checks = body.checks as PilotConfirmationChecks
        const confirmedBy = session.user.email ?? 'admin'

        if (!phrase || !checks) {
          return NextResponse.json({ error: 'Missing phrase or checks' }, { status: 400 })
        }

        const result = await submitConfirmation(batchId, confirmedBy, phrase, checks)
        if (!result.ok) {
          return NextResponse.json({ error: result.errors?.join('; ') }, { status: 422 })
        }
        return NextResponse.json({ ok: true, message: 'Confirmation submitted — smoke test unlocked' })
      }

      case 'validate_confirm': {
        // Validate without writing — for live form feedback
        const phrase = body.phrase as string ?? ''
        const checks = (body.checks ?? {}) as PilotConfirmationChecks
        const result = await validateConfirmationGate(batchId, phrase, checks)
        return NextResponse.json(result)
      }

      case 'start_smoke': {
        await liveStartSmokeTest(batchId)
        return NextResponse.json({ ok: true, message: 'Smoke test started — one lead enrolled' })
      }

      case 'verify_smoke': {
        await liveVerifySmokeTest(batchId)
        return NextResponse.json({ ok: true, message: 'Smoke test verified — remaining sends unlocked' })
      }

      case 'start_remaining': {
        await liveStartRemainingLeads(batchId)
        return NextResponse.json({ ok: true, message: 'Remaining leads enrolled' })
      }

      case 'pause': {
        await db
          .update(pilotBatches)
          .set({ firstPilotState: 'paused', status: 'paused', updatedAt: new Date() })
          .where(eq(pilotBatches.id, batchId))
        return NextResponse.json({ ok: true, message: 'Pilot paused — no further sends will occur' })
      }

      case 'cancel': {
        const reason = (body.reason as string | undefined) ?? 'Cancelled by admin'
        await db
          .update(pilotBatches)
          .set({
            firstPilotState: 'cancelled',
            status:          'cancelled',
            cancelledAt:     new Date(),
            cancelReason:    reason,
            updatedAt:       new Date(),
          })
          .where(eq(pilotBatches.id, batchId))
        return NextResponse.json({ ok: true, message: 'Pilot cancelled' })
      }

      case 'confirm_continue': {
        const confirmedBy = session.user.email ?? 'admin'
        await confirmContinuation(batchId, confirmedBy)
        return NextResponse.json({ ok: true, message: 'Continuation confirmed — remaining sends unlocked' })
      }

      case 'generate_report': {
        const report = await generatePilotReport(batchId)
        return NextResponse.json({ ok: true, report })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
