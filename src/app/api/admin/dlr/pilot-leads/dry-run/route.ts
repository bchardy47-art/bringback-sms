/**
 * GET /api/admin/dlr/pilot-leads/dry-run?tenantId=...
 *
 * Generate a dry-run report for the tenant's current pilot lead import set.
 * Returns counts, consent coverage, per-lead details, and a
 * recommendation: 'ready' | 'fix_warnings' | 'blocked'.
 *
 * No writes, no SMS, no enrollments.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { generateDryRunReport } from '@/lib/pilot/lead-import-review'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId query param is required' }, { status: 400 })
  }

  try {
    const report = await generateDryRunReport(tenantId)
    return NextResponse.json({ report })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
