/**
 * POST /api/admin/dlr/pilot-leads/import
 *
 * Import pilot lead candidates. Accepts either:
 *   - JSON body: { tenantId: string, rows: LeadImportInput[] }
 *   - CSV body: { tenantId: string, csv: string }
 *
 * Validates each row (phone normalization, dedup, consent, opt-out)
 * and stores results in pilot_lead_imports.
 *
 * Does NOT enroll leads. Does NOT send SMS.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  importLeads,
  importLeadsFromCSV,
  type LeadImportInput,
} from '@/lib/pilot/lead-import'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const importedBy = (session.user as { email?: string })?.email ?? 'admin'

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const tenantId = body.tenantId as string | undefined

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
    }

    let results: Awaited<ReturnType<typeof importLeads>>

    if (typeof body.csv === 'string') {
      // CSV import
      results = await importLeadsFromCSV(body.csv, tenantId, importedBy)
    } else if (Array.isArray(body.rows)) {
      // JSON import
      results = await importLeads(body.rows as LeadImportInput[], tenantId, importedBy)
    } else {
      return NextResponse.json(
        { error: 'Provide either "csv" (string) or "rows" (array) in the request body' },
        { status: 400 },
      )
    }

    const eligible  = results.filter(r => r.importStatus === 'eligible').length
    const warned    = results.filter(r => r.importStatus === 'warning').length
    const blocked   = results.filter(r => r.importStatus === 'blocked').length

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
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
