import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { workflowStepExecutions } from '@/lib/db/schema'
import { workflowStepQueue } from '@/lib/queue/queues'

export async function scheduleStep(
  enrollmentId: string,
  stepId: string,
  delayMs: number = 0
): Promise<string> {
  const scheduledAt = new Date(Date.now() + delayMs)

  const [execution] = await db
    .insert(workflowStepExecutions)
    .values({
      enrollmentId,
      stepId,
      status: 'pending',
      scheduledAt,
    })
    .returning()

  await workflowStepQueue.add(
    'execute-step',
    { stepExecutionId: execution.id },
    { delay: delayMs, jobId: `step-exec-${execution.id}` }
  )

  return execution.id
}

export async function cancelPendingExecutions(enrollmentId: string): Promise<void> {
  const pending = await db.query.workflowStepExecutions.findMany({
    where: eq(workflowStepExecutions.enrollmentId, enrollmentId),
  })

  for (const exec of pending) {
    if (exec.status === 'pending') {
      const job = await workflowStepQueue.getJob(`step-exec-${exec.id}`)
      if (job) await job.remove()

      await db
        .update(workflowStepExecutions)
        .set({ status: 'skipped' })
        .where(eq(workflowStepExecutions.id, exec.id))
    }
  }
}
