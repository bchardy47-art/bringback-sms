import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/requireAuth'
import { getHandoffQueue } from '@/lib/admin/dlr-queries'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const { searchParams } = new URL(req.url)
  const status = (searchParams.get('status') ?? 'open') as 'open' | 'resolved' | 'dismissed' | 'all'
  const limit  = Math.min(200, parseInt(searchParams.get('limit')  ?? '100'))
  const offset = Math.max(0,   parseInt(searchParams.get('offset') ?? '0'))

  const tasks = await getHandoffQueue(session.user.tenantId, { status, limit, offset })
  return NextResponse.json({ tasks, count: tasks.length })
}
