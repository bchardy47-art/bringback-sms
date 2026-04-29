/**
 * GET /api/admin/dlr/pilot-pack/export/sample-messages?tenantId=...
 *
 * Download sample messages as a plain text file for 10DLC TCR submission.
 * Extracts unique rendered message bodies from selected leads' previews,
 * deduplicated by step position with main/fallback variants shown.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { exportSampleMessages } from '@/lib/pilot/pilot-pack'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId query param is required' }, { status: 400 })
  }

  try {
    const text = await exportSampleMessages(tenantId)
    return new NextResponse(text, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="10dlc-sample-messages-${tenantId.slice(0, 8)}.txt"`,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
