/**
 * DLR background worker process.
 * Run with: npm run worker  (tsx worker.ts)
 *
 * Starts the BullMQ workers and schedules the repeating stale-detection job.
 * Run this process alongside the Next.js app server.
 */
import 'dotenv/config'
import { staleDetectionQueue } from './src/lib/queue/queues'
import { startWorkers } from './src/lib/queue/worker'

async function main() {
  startWorkers()

  // Register the repeating stale-detection job (safe to call every boot — BullMQ dedupes by key)
  await staleDetectionQueue.add(
    'detect-stale',
    {},
    {
      repeat: { every: 60 * 60 * 1000 }, // every hour
      jobId: 'stale-detection-recurring',
    }
  )

  console.log('[worker] DLR worker running. Stale detection: every 60 min.')
}

main().catch((err) => {
  console.error('[worker] Fatal error:', err)
  process.exit(1)
})
