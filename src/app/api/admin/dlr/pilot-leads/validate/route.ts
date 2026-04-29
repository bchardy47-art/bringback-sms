/**
 * POST /api/admin/dlr/pilot-leads/validate
 *
 * Validate a single lead import row without writing to the database.
 * Used for live form feedback before committing an import.
 *
 * Body: { tenantId: string, lead: LeadImportInput }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { validateSingleLead, type LeadImportInput } from '@/lib/pilot/lead-import'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const tenantId = body.tenantId as string | undefined
    const lead     = body.lead as LeadImportInput | undefined

    if (!tenantId || !lead) {
      return NextResponse.json(
        { error: 'tenantId and lead are required' },
        { status: 400 },
      )
    }

    const result = await validateSingleLead(lead, tenantId)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
