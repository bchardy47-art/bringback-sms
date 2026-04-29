/**
 * POST /api/admin/dlr/tenants/:id/live-approve
 *
 * Grants live-SMS approval for a tenant and records audit fields.
 * Blocked if:
 *   - tenant.tenDlcStatus is not approved / exempt / dev_override
 *   - tenant.complianceBlocked = true
 *
 * Body (optional):
 *   { tenDlcStatus?: TenDlcStatus }  — can update 10DLC status in the same call
 */

import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import type { TenDlcStatus } from '@/lib/db/schema'

const LIVE_READY_DLC_STATUSES: TenDlcStatus[] = ['approved', 'exempt', 'dev_override']

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  if (params.id !== session.user.tenantId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { tenDlcStatus?: TenDlcStatus }

  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, params.id) })
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  if (tenant.complianceBlocked) {
    return NextResponse.json(
      { error: 'Cannot approve live sends while tenant has an active compliance block', complianceBlockReason: tenant.complianceBlockReason },
      { status: 422 }
    )
  }

  // Determine effective 10DLC status
  const effectiveDlcStatus = (body.tenDlcStatus ?? tenant.tenDlcStatus) as TenDlcStatus
  if (!LIVE_READY_DLC_STATUSES.includes(effectiveDlcStatus)) {
    return NextResponse.json(
      {
        error: `10DLC status "${effectiveDlcStatus}" is not ready for live sends`,
        required: LIVE_READY_DLC_STATUSES,
      },
      { status: 422 }
    )
  }

  await db
    .update(tenants)
    .set({
      smsLiveApproved: true,
      tenDlcStatus: effectiveDlcStatus,
      liveActivatedAt: new Date(),
      liveActivatedBy: session.user.email ?? session.user.id,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, params.id))

  return NextResponse.json({
    success: true,
    smsLiveApproved: true,
    tenDlcStatus: effectiveDlcStatus,
    liveActivatedAt: new Date().toISOString(),
    liveActivatedBy: session.user.email ?? session.user.id,
  })
}
