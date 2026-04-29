/**
 * POST /api/admin/dlr/tenants/:id/compliance-block
 *
 * Sets a hard compliance block on a tenant, preventing all live sends.
 * Automatically resets smsLiveApproved to false.
 *
 * Body: { reason: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  if (params.id !== session.user.tenantId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { reason?: string }
  const reason = body.reason?.trim() || 'No reason given'

  await db
    .update(tenants)
    .set({
      complianceBlocked: true,
      complianceBlockReason: reason,
      // Revoke live approval — tenant must re-approve after block is lifted
      smsLiveApproved: false,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, params.id))

  return NextResponse.json({
    success: true,
    complianceBlocked: true,
    complianceBlockReason: reason,
    smsLiveApproved: false,
  })
}
