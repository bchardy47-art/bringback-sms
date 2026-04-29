/**
 * GET  /api/admin/dlr/pilot-leads/[id]?tenantId=...
 *   — Return a single pilot lead import row.
 *
 * PATCH /api/admin/dlr/pilot-leads/[id]
 *   Body: { tenantId, selected: boolean }
 *   — Toggle selection state (Phase 14).
 *
 *   Body: { tenantId, updates: UpdateImportedLeadInput }
 *   — Edit lead fields + re-validate (Phase 15).
 *
 * DELETE /api/admin/dlr/pilot-leads/[id]?tenantId=...
 *   — Mark as excluded (soft delete).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { excludeImportedLead, setLeadSelected } from '@/lib/pilot/lead-import'
import { updateImportedLead } from '@/lib/pilot/lead-import-review'
import { db } from '@/lib/db'
import { pilotLeadImports } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

type RouteContext = { params: { id: string } }

export async function GET(req: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId query param is required' }, { status: 400 })
  }

  const row = await db.query.pilotLeadImports.findFirst({
    where: and(
      eq(pilotLeadImports.id, params.id),
      eq(pilotLeadImports.tenantId, tenantId),
    ),
  })

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ lead: row })
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const tenantId = body.tenantId as string | undefined

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
    }

    // Route A: field edit + re-validate
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

    // Route B: toggle selection
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
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId query param is required' }, { status: 400 })
  }

  try {
    await excludeImportedLead(params.id, tenantId)
    return NextResponse.json({ ok: true, message: 'Lead excluded from import session' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
