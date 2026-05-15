/**
 * Dealer-side mirror of /api/admin/dlr/pilot-leads/[id].
 *
 * GET    — fetch a single pilot lead import row for the dealer's tenant
 * PATCH  — toggle selection or update fields (body: { selected } or { updates })
 * DELETE — soft-exclude a row from the import session
 *
 * Operations are scoped to session.user.tenantId — dealers can only touch
 * rows in their own tenant.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDealer } from '@/lib/api/requireAuth'
import { excludeImportedLead, setLeadSelected } from '@/lib/pilot/lead-import'
import { updateImportedLead } from '@/lib/pilot/lead-import-review'
import { db } from '@/lib/db'
import { pilotLeadImports } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

type RouteContext = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { session, error } = await requireDealer()
  if (error) return error

  const row = await db.query.pilotLeadImports.findFirst({
    where: and(
      eq(pilotLeadImports.id, params.id),
      eq(pilotLeadImports.tenantId, session.user.tenantId),
    ),
  })

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ lead: row })
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { session, error } = await requireDealer()
  if (error) return error
  const tenantId = session.user.tenantId

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>

    if (body.updates && typeof body.updates === 'object') {
      const result = await updateImportedLead(
        params.id,
        body.updates as Record<string, string>,
        tenantId,
      )
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 422 })
      }
      return NextResponse.json(result)
    }

    if (typeof body.selected === 'boolean') {
      const result = await setLeadSelected(params.id, body.selected, tenantId)
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 422 })
      }
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json(
      { error: 'Provide either { updates } (edit) or { selected } (toggle selection)' },
      { status: 400 },
    )
  } catch (err) {
    console.error('[dealer/pilot-leads/:id PATCH]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { session, error } = await requireDealer()
  if (error) return error

  try {
    await excludeImportedLead(params.id, session.user.tenantId)
    return NextResponse.json({ ok: true, message: 'Lead excluded from import session' })
  } catch (err) {
    console.error('[dealer/pilot-leads/:id DELETE]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
