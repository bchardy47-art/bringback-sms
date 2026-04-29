/**
 * GET  /api/admin/dlr/pilot-leads?tenantId=...
 *
 * Return all imported pilot lead candidates for a tenant.
 * Optionally renders previews for a given workflowId.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  getImportedLeads,
  setLeadSelected,
} from '@/lib/pilot/lead-import'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId query param is required' }, { status: 400 })
  }

  try {
    const rows = await getImportedLeads(tenantId)
    return NextResponse.json({ ok: true, count: rows.length, rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/dlr/pilot-leads
 * Body: { tenantId, importId, selected: boolean }
 *
 * Toggle selection for a single lead import row.
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const { tenantId, importId, selected } = body as {
      tenantId: string; importId: string; selected: boolean
    }

    if (!tenantId || !importId || typeof selected !== 'boolean') {
      return NextResponse.json(
        { error: 'tenantId, importId, and selected (boolean) are required' },
        { status: 400 },
      )
    }

    const result = await setLeadSelected(importId, selected, tenantId)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
