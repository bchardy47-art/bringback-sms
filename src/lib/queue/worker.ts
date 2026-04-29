import { Worker } from 'bullmq'
import { redisConnection } from './queues'
import { executeStep } from '@/lib/engine/executor'
import { detectStaleLeads, enrollEligibleLeads } from '@/lib/engine/enroll'
import { runEligibilityPass } from '@/lib/engine/eligibility'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'

// ── Environment ───────────────────────────────────────────────────────────────
//
// DRY_RUN=true  →  Phases 1 and 2 run normally (stale detection + eligibility
//                  evaluation), but Phase 2 does NOT write revival_eligible
//                  transitions, and Phase 3 (enrollment) is skipped entirely.
//                  Use this to preview who would be enrolled without texting anyone.

const DRY_RUN = process.env.DRY_RUN === 'true'

export function startWorkers() {
  // ── Workflow step worker ───────────────────────────────────────────────────
  // Executes individual workflow steps (send SMS, evaluate condition, assign lead).
  // Concurrency 5: up to 5 steps execute in parallel across all tenants.

  const stepWorker = new Worker(
    'workflow-steps',
    async (job) => {
      const { stepExecutionId } = job.data as { stepExecutionId: string; isRetry?: boolean }
      await executeStep(stepExecutionId)
    },
    { connection: redisConnection, concurrency: 5 }
  )

  stepWorker.on('failed', (job, err) => {
    console.error(`[worker/steps] Job ${job?.id} failed:`, err.message)
  })

  // ── Revival pipeline worker ────────────────────────────────────────────────
  // Runs on a schedule (every hour). Executes three sequential phases per tenant:
  //
  //   Phase 1 — Stale Detection
  //     Marks leads as stale when they've been inactive past the threshold.
  //     Does NOT enroll anyone. Output: leads in state = 'stale'.
  //
  //   Phase 2 — Eligibility Pass
  //     Evaluates each stale/orphaned lead against all suppression rules.
  //     Eligible leads are transitioned to revival_eligible.
  //     Suppressed leads are logged with their reason and left untouched.
  //     Output: leads in state = 'revival_eligible'.
  //
  //   Phase 3 — Enrollment
  //     Picks up revival_eligible leads and enrolls them into active workflows.
  //     Each enrollment schedules the first message step into BullMQ.
  //     Output: leads in state = 'enrolled', steps queued.
  //
  // DRY_RUN=true skips Phase 2 transitions and Phase 3 entirely.

  const revivalWorker = new Worker(
    'stale-detection',
    async () => {
      if (DRY_RUN) {
        console.log('[pipeline] ─────────────────────────────────────────────')
        console.log('[pipeline] DRY RUN MODE — no state changes or enrollments will be written')
        console.log('[pipeline] ─────────────────────────────────────────────')
      }

      const allTenants = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)

      for (const tenant of allTenants) {
        console.log(`[pipeline] ── Tenant: ${tenant.name} (${tenant.id}) ────────────────`)

        try {
          // Phase 1: stale detection
          const marked = await detectStaleLeads(tenant.id)

          // Phase 2: eligibility pass (dry-run aware)
          const eligibility = await runEligibilityPass(tenant.id, { dryRun: DRY_RUN })

          // Phase 3: enroll revival_eligible leads (skipped in dry-run)
          const enrolled = DRY_RUN ? 0 : await enrollEligibleLeads(tenant.id)

          // Summary
          const dryNote = DRY_RUN ? ' [DRY RUN — no sends]' : ''
          console.log(
            `[pipeline] Summary${dryNote}: ` +
            `${marked} marked stale | ` +
            `${eligibility.evaluated} evaluated | ` +
            `${eligibility.eligible} eligible | ` +
            `${eligibility.suppressed} suppressed | ` +
            `${enrolled} enrolled`
          )

          if (eligibility.suppressed > 0) {
            const reasons = Object.entries(eligibility.byReason)
              .filter(([r]) => r !== 'ok')
              .map(([r, n]) => `  ${r}: ${n}`)
              .join('\n')
            if (reasons) console.log(`[pipeline] Suppression breakdown:\n${reasons}`)
          }

        } catch (err) {
          console.error(
            `[pipeline] Error processing tenant ${tenant.name} (${tenant.id}):`,
            err instanceof Error ? err.message : err
          )
          // Continue to next tenant — don't let one bad tenant block others
        }
      }
    },
    { connection: redisConnection, concurrency: 1 }
  )

  revivalWorker.on('failed', (_, err) => {
    console.error('[worker/revival] Pipeline job failed:', err.message)
  })

  console.log(
    `[worker] Workers started${DRY_RUN ? ' — DRY RUN MODE (no SMS will be sent)' : ''}`
  )
  return { stepWorker, revivalWorker }
}
