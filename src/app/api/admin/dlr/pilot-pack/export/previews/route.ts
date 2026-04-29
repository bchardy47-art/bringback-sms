/**
 * GET /api/admin/dlr/pilot-pack/export/previews?tenantId=...
 *
 * Download message previews for selected pilot leads as a CSV.
 * One row per (lead × message step). Includes opt-out footer detection.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { exportPreviewsCSV } from '@/lib/pilot/pilot-pack'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId query param is required' }, { status: 400 })
  }

  try {
    const csv = await exportPreviewsCSV(tenantId)
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pilot-message-previews-${tenantId.slice(0, 8)}.csv"`,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
