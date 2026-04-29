/**
 * GET /api/admin/dlr/pilot-pack?tenantId=...
 *
 * Returns the full Pilot Data Pack for a tenant:
 * readiness score, 10DLC waiting status, selected leads, dry-run report.
 *
 * No writes, no sends, no enrollments.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getPilotPackData } from '@/lib/pilot/pilot-pack'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId query param is required' }, { status: 400 })
  }

  try {
    const pack = await getPilotPackData(tenantId)
    return NextResponse.json({ pack })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
