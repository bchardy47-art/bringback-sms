/**
 * POST /api/conversations/[id]/take-over
 *
 * Manager action: claim a reviving conversation for human follow-up.
 *
 * Effects:
 *   1. Transitions lead state: responded → revived
 *   2. Pauses any active workflow enrollment for this lead
 *   3. Stamps humanTookOverAt on the conversation
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { and, eq } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { conversations, workflowEnrollments } from '@/lib/db/schema'
import { transition } from '@/lib/lead/state-machine'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const conv = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, params.id),
      eq(conversations.tenantId, session.user.tenantId)
    ),
    with: { lead: true },
  })

  if (!conv) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Idempotent — if already taken over, return success without re-running
  if (conv.humanTookOverAt) {
    return NextResponse.json({ ok: true, alreadyTakenOver: true })
  }

  const lead = conv.lead

  // 1. Transition: responded → revived (state machine validates this)
  //    No-op if already revived (idempotent).
  if (lead.state === 'responded') {
    await transition(lead.id, 'revived', {
      reason: 'Human took over conversation',
      actor: `user:${session.user.id}`,
    })
  }

  // 2. Pause any active workflow enrollment so automation stops
  await db
    .update(workflowEnrollments)
    .set({ status: 'paused' })
    .where(
      and(
        eq(workflowEnrollments.leadId, lead.id),
        eq(workflowEnrollments.status, 'active')
      )
    )

  // 3. Stamp the takeover timestamp
  await db
    .update(conversations)
    .set({ humanTookOverAt: new Date(), updatedAt: new Date() })
    .where(eq(conversations.id, conv.id))

  return NextResponse.json({ ok: true })
}
