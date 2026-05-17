import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/requireAuth'
import { pauseTenantAutomation } from '@/lib/admin/dlr-queries'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAdmin()
  if (error) return error

  // Tenants can only pause their own tenant
  if (params.id !== session.user.tenantId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await pauseTenantAutomation(session.user.tenantId)
  return NextResponse.json({ success: true, automationPaused: true })
}
