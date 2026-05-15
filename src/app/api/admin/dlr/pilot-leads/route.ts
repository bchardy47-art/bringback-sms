/**
 * GET  /api/admin/dlr/pilot-leads
 *   — Return all imported pilot lead candidates for the caller's tenant.
 *
 * PATCH /api/admin/dlr/pilot-leads
 *   Body: { importId, selected: boolean }
 *   — Toggle selection for a single lead import row.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/requireAuth'
import {
  getImportedLeads,
  setLeadSelected,
} from '@/lib/pilot/lead-import'

export async function GET() {
  const { session, error } = await requireAdmin()
  if (error) return error

  try {
    const rows = await getImportedLeads(session.user.tenantId)
    return NextResponse.json({ ok: true, count: rows.length, rows })
  } catch (err) {
    console.error('[pilot-leads GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const { session, error } = await requireAdmin()
  if (error) return error

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const { importId, selected } = body as { importId: string; selected: boolean }

    if (!importId || typeof selected !== 'boolean') {
      return NextResponse.json(
        { error: 'importId and selected (boolean) are required' },
        { status: 400 },
      )
    }

    const result = await setLeadSelected(importId, selected, session.user.tenantId)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[pilot-leads PATCH]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
