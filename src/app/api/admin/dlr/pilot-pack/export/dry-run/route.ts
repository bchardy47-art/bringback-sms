/**
 * GET /api/admin/dlr/pilot-pack/export/dry-run?tenantId=...
 *
 * Download the dry-run report as a formatted JSON file.
 * Includes warnings, blockers, consent coverage, duplicate findings.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/requireAuth'
import { exportDryRunJSON } from '@/lib/pilot/pilot-pack'

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId query param is required' }, { status: 400 })
  }

  try {
    const json = await exportDryRunJSON(tenantId)
    return new NextResponse(json, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="pilot-dry-run-${tenantId.slice(0, 8)}.json"`,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
