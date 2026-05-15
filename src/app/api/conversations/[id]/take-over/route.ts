/**
 * POST /api/conversations/[id]/take-over
 *
 * Manager / dealer action: permanently claim a conversation for human follow-up.
 *
 * Effects (all atomic):
 *   1. Stamps humanTookOverAt + takenOverBy on the conversation
 *   2. Cancels all active enrollments for this lead (status = cancelled, stopReason = human_takeover)
 *   3. Sets doNotAutomate = true on the lead (permanent — no auto-resume)
 *   4. Removes pending BullMQ jobs via cancelPendingExecutions()
 *
 * Idempotent: if humanTookOverAt is already set, returns { ok: true } immediately.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { and, eq } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { conversations, workflowEnrollments, leads } from '@/lib/db/schema'
import { cancelPendingExecutions } from '@/lib/engine/scheduler'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, params.id),
      eq(conversations.tenantId, session.user.tenantId)
    ),
    with: {
      lead: {
        with: {
          // Fetch ALL enrollments — we need to clean up pending executions
          // even if the enrollment was already cancelled by the reply handler.
          enrollments: true,
        },
      },
    },
  })

  if (!conversation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Idempotent — already taken over, nothing to do
  if (conversation.humanTookOverAt) {
    return NextResponse.json({ ok: true, alreadyTakenOver: true })
  }

  const now = new Date()
  const allEnrollments = conversation.lead.enrollments
  const activeEnrollments = allEnrollments.filter((e) => e.status === 'active')

  // Atomic DB changes
  await db.transaction(async (tx) => {
    // 1. Stamp the conversation
    await tx
      .update(conversations)
      .set({
        humanTookOverAt: now,
        takenOverBy: session.user.id,
        updatedAt: now,
      })
      .where(eq(conversations.id, conversation.id))

    // 2. Cancel any still-active enrollments — one-way, no resume
    for (const enrollment of activeEnrollments) {
      await tx
        .update(workflowEnrollments)
        .set({
          status: 'cancelled',
          stopReason: 'human_takeover',
          stoppedAt: now,
        })
        .where(eq(workflowEnrollments.id, enrollment.id))
    }

    // 3. Hard-block the lead from all future automation
    await tx
      .update(leads)
      .set({ doNotAutomate: true, updatedAt: now })
      .where(eq(leads.id, conversation.leadId))
  })

  // 4. Remove pending BullMQ jobs for ALL enrollments (not just newly-cancelled ones).
  //    Handles the case where the reply handler already cancelled the enrollment but
  //    left a pending step execution in the queue.
  for (const enrollment of allEnrollments) {
    await cancelPendingExecutions(enrollment.id)
  }

  return NextResponse.json({ ok: true })
}
