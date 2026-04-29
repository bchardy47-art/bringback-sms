/**
 * POST /api/admin/dlr/tenants/:id/compliance-unblock
 *
 * Lifts a compliance block. Does NOT re-grant smsLiveApproved —
 * that must be done explicitly via the live-approve endpoint.
 */

import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  if (params.id !== session.user.tenantId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await db
    .update(tenants)
    .set({
      complianceBlocked: false,
      complianceBlockReason: null,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, params.id))

  return NextResponse.json({
    success: true,
    complianceBlocked: false,
    // Note: smsLiveApproved remains false — re-approve via live-approve endpoint
    message: 'Compliance block lifted. Re-approve tenant for live sends via the live-approve endpoint.',
  })
}
