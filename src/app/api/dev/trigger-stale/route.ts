/**
 * DEV-ONLY — manually trigger the stale detection + auto-enroll cycle.
 *
 * In production this route returns 404 unconditionally. It is intentionally
 * NOT protected by session auth in dev so it can be called from curl or the
 * simulate-webhook script without a cookie jar.
 *
 * Usage (dev only):
 *   curl -X POST http://localhost:3000/api/dev/trigger-stale \
 *        -H 'Content-Type: application/json' \
 *        -d '{"tenantId":"<uuid>"}'
 *
 * Response:
 *   { "marked": 3, "enrolled": 6 }
 */

import { NextRequest, NextResponse } from 'next/server'
import { detectStaleLeads, autoEnrollStaleLeads } from '@/lib/engine/enroll'

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Hard block in production — return a generic 404 so the route isn't
  // even discoverable by scanners.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let tenantId: string | undefined
  try {
    const body = await req.json() as { tenantId?: string }
    tenantId = body.tenantId
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }

  console.log(`[dev/trigger-stale] Running for tenant ${tenantId}`)

  const marked = await detectStaleLeads(tenantId)
  const enrolled = await autoEnrollStaleLeads(tenantId)

  console.log(`[dev/trigger-stale] marked=${marked} enrolled=${enrolled}`)

  return NextResponse.json({ marked, enrolled })
}
