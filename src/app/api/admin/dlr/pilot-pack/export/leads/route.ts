/**
 * GET /api/admin/dlr/pilot-pack/export/leads?tenantId=...
 *
 * Download selected pilot leads as a CSV file.
 * Only returns leads with importStatus = 'selected'.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/requireAuth'
import { exportLeadsCSV } from '@/lib/pilot/pilot-pack'

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId query param is required' }, { status: 400 })
  }

  try {
    const csv = await exportLeadsCSV(tenantId)
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pilot-leads-${tenantId.slice(0, 8)}.csv"`,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
