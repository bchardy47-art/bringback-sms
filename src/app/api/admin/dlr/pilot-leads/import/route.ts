/**
 * POST /api/admin/dlr/pilot-leads/import
 *
 * Import pilot lead candidates for the caller's tenant. Accepts either:
 *   - JSON body: { rows: LeadImportInput[] }
 *   - CSV body:  { csv: string }
 *
 * Validates each row and stores results in pilot_lead_imports.
 * Does NOT enroll leads. Does NOT send SMS.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/requireAuth'
import {
  importLeads,
  importLeadsFromCSV,
  type LeadImportInput,
} from '@/lib/pilot/lead-import'

export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin()
  if (error) return error
  const tenantId   = session.user.tenantId
  const importedBy = session.user.email ?? 'admin'

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>

    let results: Awaited<ReturnType<typeof importLeads>>

    if (typeof body.csv === 'string') {
      results = await importLeadsFromCSV(body.csv, tenantId, importedBy)
    } else if (Array.isArray(body.rows)) {
      results = await importLeads(body.rows as LeadImportInput[], tenantId, importedBy)
    } else {
      return NextResponse.json(
        { error: 'Provide either "csv" (string) or "rows" (array) in the request body' },
        { status: 400 },
      )
    }

    const eligible = results.filter(r => r.importStatus === 'eligible').length
    const warned   = results.filter(r => r.importStatus === 'warning').length
    const blocked  = results.filter(r => r.importStatus === 'blocked').length

    return NextResponse.json({
      ok:      true,
      count:   results.length,
      eligible,
      warned,
      blocked,
      results: results.map(r => ({
        id:             r.id,
        firstName:      r.firstName,
        lastName:       r.lastName,
        phone:          r.phone,
        phoneRaw:       r.phoneRaw,
        importStatus:   r.importStatus,
        blockedReasons: r.blockedReasons ?? [],
        warnings:       r.warnings ?? [],
        duplicateOfLeadId:   r.duplicateOfLeadId,
        duplicateOfImportId: r.duplicateOfImportId,
      })),
    })
  } catch (err) {
    console.error('[pilot-leads/import]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
