/**
 * GET /api/dealer/pilot-leads/dry-run
 *
 * Dealer-side mirror — dry-run summary report for the dealer's own tenant.
 * Read-only, no writes, no SMS.
 */

import { NextResponse } from 'next/server'
import { requireDealer } from '@/lib/api/requireAuth'
import { generateDryRunReport } from '@/lib/pilot/lead-import-review'

export async function GET() {
  const { session, error } = await requireDealer()
  if (error) return error

  try {
    const report = await generateDryRunReport(session.user.tenantId)
    return NextResponse.json({ report })
  } catch (err) {
    console.error('[dealer/pilot-leads/dry-run]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
