/**
 * POST /api/dealer/pilot-leads/select-all-eligible
 *
 * Dealer-side mirror of the admin select-all-eligible endpoint.
 * Bulk-promotes the dealer's own tenant's eligible (and warning) imports to
 * 'selected', stopping at FIRST_PILOT_CAP and skipping rows that cannot be
 * promoted at this stage:
 *   - revoked / unknown consent → cannot be selected (first-pilot consent gate)
 *   - needs_review (missing date)→ cannot be bucketed
 *   - blocked / excluded         → already disqualified
 *
 * Returns { ok, selected, skipped, capped }.
 */

import { NextResponse } from 'next/server'
import { requireDealer } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { pilotLeadImports, FIRST_PILOT_CAP } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'

export async function POST() {
  const { session, error } = await requireDealer()
  if (error) return error

  const tenantId = session.user.tenantId

  try {
    // Headroom under the first-pilot cap
    const alreadySelected = await db
      .select({ id: pilotLeadImports.id })
      .from(pilotLeadImports)
      .where(and(
        eq(pilotLeadImports.tenantId, tenantId),
        eq(pilotLeadImports.importStatus, 'selected'),
      ))
    const headroom = Math.max(0, FIRST_PILOT_CAP - alreadySelected.length)

    if (headroom === 0) {
      return NextResponse.json({
        ok:       true,
        selected: 0,
        skipped:  0,
        capped:   true,
        message:  `Selection is already at the first-pilot cap of ${FIRST_PILOT_CAP} leads.`,
      })
    }

    // Pull candidate rows. We include both 'eligible' and 'warning' — the
    // selection-time consent gate in setLeadSelected() also accepts both.
    // needs_review / held / blocked / excluded are filtered server-side.
    const candidates = await db
      .select()
      .from(pilotLeadImports)
      .where(and(
        eq(pilotLeadImports.tenantId, tenantId),
        inArray(pilotLeadImports.importStatus, ['eligible', 'warning']),
      ))
      .orderBy(pilotLeadImports.createdAt)

    // Apply the same per-lead gates as setLeadSelected — unknown / revoked
    // consent cannot be selected for the first pilot.
    const selectable = candidates.filter(r => {
      const c = (r.consentStatus ?? 'unknown').toLowerCase().trim()
      return c === 'explicit' || c === 'implied'
    })

    const willPromote = selectable.slice(0, headroom)
    if (willPromote.length === 0) {
      return NextResponse.json({
        ok:       true,
        selected: 0,
        skipped:  candidates.length,
        capped:   false,
        message:  candidates.length > 0
          ? 'No eligible rows could be selected — confirm consent for at least one lead and try again.'
          : 'No eligible rows to select.',
      })
    }

    const updated = await db
      .update(pilotLeadImports)
      .set({
        importStatus:     'selected',
        selectedForBatch: true,
        updatedAt:        new Date(),
      })
      .where(and(
        eq(pilotLeadImports.tenantId, tenantId),
        inArray(pilotLeadImports.id, willPromote.map(r => r.id)),
      ))
      .returning({ id: pilotLeadImports.id })

    const capped = candidates.length > headroom
    return NextResponse.json({
      ok:       true,
      selected: updated.length,
      skipped:  candidates.length - updated.length,
      capped,
      message:  capped
        ? `Selected ${updated.length} (capped at ${FIRST_PILOT_CAP} for the first pilot).`
        : `Selected ${updated.length} lead${updated.length === 1 ? '' : 's'}.`,
    })
  } catch (err) {
    console.error('[dealer/pilot-leads/select-all-eligible]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
