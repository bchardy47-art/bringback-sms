/**
 * GET /api/admin/dlr/readiness
 *
 * Returns the full preflight readiness result for the requesting tenant,
 * optionally scoped to a specific workflow via ?workflowId=<uuid>.
 *
 * Response shape mirrors PreflightResult from src/lib/engine/preflight.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/requireAuth'
import { runPreflight } from '@/lib/engine/preflight'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const { searchParams } = new URL(req.url)
  const workflowId = searchParams.get('workflowId') ?? undefined

  const result = await runPreflight(session.user.tenantId, workflowId)

  return NextResponse.json(result)
}
