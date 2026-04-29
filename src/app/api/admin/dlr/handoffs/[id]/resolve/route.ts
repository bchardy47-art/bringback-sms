import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/requireAuth'
import { resolveHandoffTask } from '@/lib/handoff/handoff-agent'
import { db } from '@/lib/db'
import { handoffTasks } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const taskId = params.id

  // Verify the task belongs to this tenant
  const task = await db.query.handoffTasks.findFirst({
    where: and(eq(handoffTasks.id, taskId), eq(handoffTasks.tenantId, session.user.tenantId)),
  })
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  await resolveHandoffTask({ taskId, resolvedBy: session.user.id })

  return NextResponse.json({ success: true, taskId })
}
