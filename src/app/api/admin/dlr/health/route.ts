import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/requireAuth'
import { getAutomationHealth } from '@/lib/admin/dlr-queries'

export async function GET(): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const health = await getAutomationHealth(session.user.tenantId)
  if (!health) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  return NextResponse.json(health)
}
