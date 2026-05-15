/**
 * POST /api/dealer/pilot-leads/bulk-clear
 *
 * Dealer-side mirror — excludes all blocked import rows for the dealer's
 * own tenant.
 */

import { NextResponse } from 'next/server'
import { requireDealer } from '@/lib/api/requireAuth'
import { bulkClearBlocked } from '@/lib/pilot/lead-import-review'

export async function POST() {
  const { session, error } = await requireDealer()
  if (error) return error

  try {
    const cleared = await bulkClearBlocked(session.user.tenantId)
    return NextResponse.json({ ok: true, cleared })
  } catch (err) {
    console.error('[dealer/pilot-leads/bulk-clear]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
