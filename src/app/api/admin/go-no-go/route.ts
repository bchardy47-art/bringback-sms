/**
 * Phase 12 — Go/No-Go Report API
 *
 * GET  /api/admin/go-no-go         — Generate report for all tenants
 * GET  /api/admin/go-no-go?tenantId=<id>  — Generate report for a specific tenant
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { generateGoNoGoReport, generateGoNoGoReportAll } from '@/lib/pilot/go-no-go'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenantId')

    if (tenantId) {
      const report = await generateGoNoGoReport(tenantId)
      return NextResponse.json(report)
    }

    const reports = await generateGoNoGoReportAll()
    return NextResponse.json(reports)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
