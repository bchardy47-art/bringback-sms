/**
 * GET /api/dealer/campaigns/[batchId]/report/export
 *
 * Dealer-only CSV export of the campaign report for a single pilot batch.
 * Tenant-scoped via requireDealer + the aggregator's tenantId arg, so a
 * dealer cannot pull another tenant's batch even by guessing the UUID.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDealer } from '@/lib/api/requireAuth'
import { getCampaignReport, reportToCSV } from '@/lib/pilot/campaign-report'

export async function GET(
  _req: NextRequest,
  ctx: { params: { batchId: string } },
) {
  const { session, error } = await requireDealer()
  if (error) return error

  const { batchId } = ctx.params
  const result = await getCampaignReport({
    batchId,
    tenantId: session.user.tenantId,
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
