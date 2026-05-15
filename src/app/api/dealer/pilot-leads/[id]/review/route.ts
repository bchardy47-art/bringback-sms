/**
 * POST /api/dealer/pilot-leads/[id]/review
 *
 * Dealer-side mirror — marks a pilot lead import row as reviewed by the
 * current dealer. Tenant-scoped.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDealer } from '@/lib/api/requireAuth'
import { markReviewed } from '@/lib/pilot/lead-import-review'

type RouteContext = { params: { id: string } }

export async function POST(_req: NextRequest, { params }: RouteContext) {
  const { session, error } = await requireDealer()
  if (error) return error

  try {
    const reviewedBy = session.user.email ?? session.user.name ?? 'dealer'
    const result = await markReviewed(params.id, reviewedBy, session.user.tenantId)

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[dealer/pilot-leads/:id/review]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
