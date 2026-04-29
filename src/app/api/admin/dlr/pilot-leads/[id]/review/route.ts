/**
 * POST /api/admin/dlr/pilot-leads/[id]/review
 * Body: { tenantId }
 *
 * Mark a pilot lead import row as reviewed by the current admin.
 * Idempotent — safe to call multiple times.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { markReviewed } from '@/lib/pilot/lead-import-review'

type RouteContext = { params: { id: string } }

export async function POST(req: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const tenantId = body.tenantId as string | undefined
    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
    }

    const reviewedBy = session.user?.email ?? session.user?.name ?? 'admin'
    const result = await markReviewed(params.id, reviewedBy, tenantId)

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
