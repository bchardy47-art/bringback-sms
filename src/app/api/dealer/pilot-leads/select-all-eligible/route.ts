/**
 * POST /api/dealer/pilot-leads/select-all-eligible
 *
 * Dealer-side mirror of the admin select-all-eligible endpoint.
 * Bulk-promotes the dealer's own tenant's eligible imports to 'selected'.
 */

import { NextResponse } from 'next/server'
import { requireDealer } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { pilotLeadImports } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

export async function POST() {
  const { session, error } = await requireDealer()
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
    console.error('[dealer/pilot-leads/select-all-eligible]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
