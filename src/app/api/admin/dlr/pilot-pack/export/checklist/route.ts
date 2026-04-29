/**
 * GET /api/admin/dlr/pilot-pack/export/checklist?tenantId=...
 *
 * Download the pilot launch checklist as a Markdown file.
 * Each checklist item is annotated with current pass/fail state from the DB.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { exportChecklist } from '@/lib/pilot/pilot-pack'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId query param is required' }, { status: 400 })
  }

  try {
    const md = await exportChecklist(tenantId)
    return new NextResponse(md, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="pilot-checklist-${tenantId.slice(0, 8)}.md"`,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
