/**
 * POST /api/admin/dlr/pilot-leads/validate
 *
 * Validate a single lead import row without writing.
 * Body: { lead: LeadImportInput }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/requireAuth'
import { validateSingleLead, type LeadImportInput } from '@/lib/pilot/lead-import'

export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin()
  if (error) return error

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const lead = body.lead as LeadImportInput | undefined

    if (!lead) {
      return NextResponse.json({ error: 'lead is required' }, { status: 400 })
    }

    const result = await validateSingleLead(lead, session.user.tenantId)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[pilot-leads/validate]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
