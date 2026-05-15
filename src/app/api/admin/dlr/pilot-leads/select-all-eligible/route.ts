/**
 * POST /api/admin/dlr/pilot-leads/select-all-eligible
 *
 * Bulk-promotes all 'eligible' leads to 'selected' for the caller's tenant.
 */

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { pilotLeadImports } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

export async function POST() {
  const { session, error } = await requireAdmin()
  if (error) return error

  try {
    const rows = await db
      .update(pilotLeadImports)
      .set({ importStatus: 'selected' })
      .where(and(
        eq(pilotLeadImports.tenantId, session.user.tenantId),
        eq(pilotLeadImports.importStatus, 'eligible'),
      ))
      .returning({ id: pilotLeadImports.id })

    return NextResponse.json({ ok: true, selected: rows.length })
  } catch (err) {
    console.error('[pilot-leads/select-all-eligible]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
