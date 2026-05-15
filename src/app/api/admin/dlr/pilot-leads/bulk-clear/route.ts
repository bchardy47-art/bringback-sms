/**
 * POST /api/admin/dlr/pilot-leads/bulk-clear
 *
 * Exclude all blocked import rows for the caller's tenant.
 */

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/requireAuth'
import { bulkClearBlocked } from '@/lib/pilot/lead-import-review'

export async function POST() {
  const { session, error } = await requireAdmin()
  if (error) return error

  try {
    const cleared = await bulkClearBlocked(session.user.tenantId)
    return NextResponse.json({ ok: true, cleared })
  } catch (err) {
    console.error('[pilot-leads/bulk-clear]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
