import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/api/requireAuth'
import { setLeadFlag, markLeadDead } from '@/lib/admin/dlr-queries'

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set_is_test'),        value: z.boolean() }),
  z.object({ action: z.literal('set_do_not_automate'), value: z.boolean() }),
  z.object({ action: z.literal('mark_dead'),           reason: z.string().min(1) }),
])

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const body = await req.json()
  const parsed = ActionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const leadId   = params.id
  const tenantId = session.user.tenantId

  try {
    switch (parsed.data.action) {
      case 'set_is_test':
        await setLeadFlag(tenantId, leadId, 'isTest', parsed.data.value)
        break
      case 'set_do_not_automate':
        await setLeadFlag(tenantId, leadId, 'doNotAutomate', parsed.data.value)
        break
      case 'mark_dead':
        await markLeadDead(tenantId, leadId, parsed.data.reason)
        break
    }
    return NextResponse.json({ success: true, action: parsed.data.action })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Action failed' },
      { status: 400 }
    )
  }
}
