/**
 * DEV-ONLY — manually trigger the full revival pipeline for a tenant.
 *
 * Runs all three phases:
 *   1. detectStaleLeads       — marks active → stale
 *   2. runEligibilityPass     — evaluates stale leads, marks eligible → revival_eligible
 *   3. enrollEligibleLeads    — enrolls revival_eligible leads into active workflows
 *
 * Pass dryRun: true to preview phases 1 & 2 without writing transitions or enrolling.
 *
 * In production this route returns 404 unconditionally.
 *
 * Usage:
 *   curl -X POST http://localhost:3000/api/dev/trigger-stale \
 *        -H 'Content-Type: application/json' \
 *        -d '{"tenantId":"<uuid>"}'
 *
 *   # Preview only (no state changes):
 *   curl -X POST http://localhost:3000/api/dev/trigger-stale \
 *        -H 'Content-Type: application/json' \
 *        -d '{"tenantId":"<uuid>","dryRun":true}'
 */

import { NextRequest, NextResponse } from 'next/server'
import { detectStaleLeads, enrollEligibleLeads } from '@/lib/engine/enroll'
import { runEligibilityPass } from '@/lib/engine/eligibility'

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let tenantId: string | undefined
  let dryRun = false
  try {
    const body = await req.json() as { tenantId?: string; dryRun?: boolean }
    tenantId = body.tenantId
    dryRun = body.dryRun ?? false
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }

  console.log(`[dev/trigger-stale] tenant=${tenantId} dryRun=${dryRun}`)

  // Phase 1: stale detection (always runs — marking stale is safe)
  const marked = await detectStaleLeads(tenantId)

  // Phase 2: eligibility pass (dry-run aware)
  const eligibility = await runEligibilityPass(tenantId, { dryRun })

  // Phase 3: enrollment (skipped in dry-run)
  const enrolled = dryRun ? 0 : await enrollEligibleLeads(tenantId)

  return NextResponse.json({
    dryRun,
    phase1_marked_stale: marked,
    phase2_eligibility: {
      evaluated: eligibility.evaluated,
      eligible: eligibility.eligible,
      suppressed: eligibility.suppressed,
      byReason: eligibility.byReason,
    },
    phase3_enrolled: enrolled,
    leads: dryRun ? eligibility.leads : undefined,
  })
}
