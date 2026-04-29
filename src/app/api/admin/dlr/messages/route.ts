import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/requireAuth'
import { getMessageAuditLog } from '@/lib/admin/dlr-queries'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const { searchParams } = new URL(req.url)
  const limit         = Math.min(500, parseInt(searchParams.get('limit')  ?? '100'))
  const offset        = Math.max(0,   parseInt(searchParams.get('offset') ?? '0'))
  const leadId        = searchParams.get('leadId')   ?? undefined
  const direction     = (searchParams.get('direction') ?? undefined) as 'inbound' | 'outbound' | undefined
  const skipReasonOnly = searchParams.get('skipReasonOnly') === 'true'

  const msgs = await getMessageAuditLog(session.user.tenantId, {
    limit, offset, leadId, direction, skipReasonOnly,
  })
  return NextResponse.json({ messages: msgs, count: msgs.length })
}
