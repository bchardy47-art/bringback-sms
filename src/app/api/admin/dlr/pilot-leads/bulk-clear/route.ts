/**
 * POST /api/admin/dlr/pilot-leads/bulk-clear
 * Body: { tenantId }
 *
 * Exclude all blocked import rows for a tenant (soft delete).
 * Selected leads are never blocked, so this is safe.
 * Returns { ok: true, cleared: number }.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { bulkClearBlocked } from '@/lib/pilot/lead-import-review'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const tenantId = body.tenantId as string | undefined
    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
    }

    const cleared = await bulkClearBlocked(tenantId)
    return NextResponse.json({ ok: true, cleared })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
