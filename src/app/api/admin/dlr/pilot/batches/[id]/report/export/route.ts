/**
 * GET /api/admin/dlr/pilot/batches/[batchId]/report/export
 *
 * Admin CSV export — cross-tenant. requireAdmin gates access.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/requireAuth'
import { getCampaignReport, reportToCSV } from '@/lib/pilot/campaign-report'

export async function GET(
  _req: NextRequest,
  ctx: { params: { batchId: string } },
) {
  const { error } = await requireAdmin()
  if (error) return error

  const { batchId } = ctx.params
  const result = await getCampaignReport({
    batchId,
    tenantId: null,
  })
  if (!result.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const csv = reportToCSV(result.report)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="campaign-report-${batchId.slice(0, 8)}.csv"`,
    },
  })
}
