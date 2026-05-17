import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/requireAuth'
import { getLeadDetail } from '@/lib/admin/dlr-queries'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAdmin()
  if (error) return error

  const detail = await getLeadDetail(session.user.tenantId, params.id)
  if (!detail) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  return NextResponse.json(detail)
}
