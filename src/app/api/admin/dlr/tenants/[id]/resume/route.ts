import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/requireAuth'
import { resumeTenantAutomation } from '@/lib/admin/dlr-queries'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  if (params.id !== session.user.tenantId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await resumeTenantAutomation(session.user.tenantId)
  return NextResponse.json({ success: true, automationPaused: false })
}
