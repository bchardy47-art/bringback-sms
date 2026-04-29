import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/requireAuth'
import { getSuppressionReport } from '@/lib/admin/dlr-queries'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const { searchParams } = new URL(req.url)
  const limit = Math.min(1000, parseInt(searchParams.get('limit') ?? '500'))

  const report = await getSuppressionReport(session.user.tenantId, { limit })
  return NextResponse.json(report)
}
