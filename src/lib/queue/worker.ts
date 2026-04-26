import { Worker } from 'bullmq'
import { redisConnection } from './queues'
import { executeStep } from '@/lib/engine/executor'
import { detectStaleLeads, autoEnrollStaleLeads } from '@/lib/engine/enroll'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'

export function startWorkers() {
  // ── Workflow step worker ───────────────────────────────────────────────
  const stepWorker = new Worker(
    'workflow-steps',
    async (job) => {
      const { stepExecutionId } = job.data as { stepExecutionId: string; isRetry?: boolean }
      await executeStep(stepExecutionId)
    },
    { connection: redisConnection, concurrency: 5 }
  )

  stepWorker.on('failed', (job, err) => {
    console.error(`[worker] Job ${job?.id} failed:`, err.message)
  })

  // ── Stale detection worker ─────────────────────────────────────────────
  const staleWorker = new Worker(
    'stale-detection',
    async () => {
      const allTenants = await db.select({ id: tenants.id }).from(tenants)
      for (const tenant of allTenants) {
        const marked = await detectStaleLeads(tenant.id)
        const enrolled = await autoEnrollStaleLeads(tenant.id)
        if (marked > 0 || enrolled > 0) {
          console.log(`[stale-detection] tenant ${tenant.id}: ${marked} marked stale, ${enrolled} enrolled`)
        }
      }
    },
    { connection: redisConnection, concurrency: 1 }
  )

  staleWorker.on('failed', (_, err) => {
    console.error('[worker] Stale detection failed:', err.message)
  })

  console.log('[worker] Workers started')
  return { stepWorker, staleWorker }
}
