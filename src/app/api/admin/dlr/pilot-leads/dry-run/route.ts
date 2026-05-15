/**
 * GET /api/admin/dlr/pilot-leads/dry-run
 *
 * Generate a dry-run report for the caller-tenant's current pilot lead import set.
 * Returns counts, consent coverage, per-lead details, and a recommendation.
 *
 * No writes, no SMS, no enrollments.
 */

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/requireAuth'
import { generateDryRunReport } from '@/lib/pilot/lead-import-review'

export async function GET() {
  const { session, error } = await requireAdmin()
  if (error) return error

  try {
    const report = await generateDryRunReport(session.user.tenantId)
    return NextResponse.json({ report })
  } catch (err) {
    console.error('[pilot-leads/dry-run]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
