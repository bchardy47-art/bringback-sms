import { Queue } from 'bullmq'
import IORedis from 'ioredis'

export const redisConnection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
})

// Workflow step execution queue — one job per step execution row
export const workflowStepQueue = new Queue('workflow-steps', {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 },
  },
})

// Stale detection queue — repeating job, one per tenant
export const staleDetectionQueue = new Queue('stale-detection', {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: { count: 100 },
  },
})
