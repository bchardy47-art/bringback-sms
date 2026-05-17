/**
 * Pilot Age-Bucket Workflow Step Seeder
 *
 * Finds all age-bucket workflows (ageBucket IS NOT NULL) for a given tenant
 * and inserts 5-step revival sequences (send → condition → send → condition → send)
 * appropriate to each bucket's staleness window.
 *
 * Buckets:
 *   a  14–29 days   soft re-open, lead just went quiet
 *   b  30–59 days   one month out, still plausible
 *   c  60–89 days   two to three months, lower-energy tone
 *   d  90+ days     one last check-in, keep it brief
 *
 * Behaviour:
 *   - Idempotent — wipes existing steps before re-inserting
 *   - isActive and other workflow metadata left unchanged
 *   - Safe to run multiple times
 *
 * Usage:
 *   SEED_TENANT_ID=<uuid> DATABASE_URL=postgresql://... npx tsx scripts/seed-pilot-bucket-steps.ts
 *
 * Or omit SEED_TENANT_ID to target the first tenant in the DB (dev/test only).
 */

import { config } from 'dotenv'
config({ path: new URL('../.env.local', import.meta.url).pathname })

import { eq, and, isNotNull } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { tenants, workflows, workflowSteps } from '../src/lib/db/schema'
import type { SendSmsConfig, ConditionConfig } from '../src/lib/db/schema'

// ── Step factories ─────────────────────────────────────────────────────────────

function sms(
  position: number,
  template: string,
  fallbackTemplate: string,
  delayHours: number,
): { type: 'send_sms'; position: number; config: SendSmsConfig } {
  return {
    type: 'send_sms',
    position,
    config: {
      type: 'send_sms',
      template,
      fallbackTemplate,
      delayHours,
    },
  }
}

function stopIfReplied(position: number): { type: 'condition'; position: number; config: ConditionConfig } {
  return {
    type: 'condition',
    position,
    config: {
      type: 'condition',
      field: 'lead.responded',
      operator: 'eq',
      value: 'true',
      ifTrue: 'stop',
      ifFalse: 'continue',
    },
  }
}

// ── Bucket message sequences ───────────────────────────────────────────────────

type BucketStep =
  | ReturnType<typeof sms>
  | ReturnType<typeof stopIfReplied>

const BUCKET_STEPS: Record<string, BucketStep[]> = {

  /**
   * Bucket A — 14–29 days
   * Lead went quiet recently. Tone: casual re-open, like you just noticed.
   */
  a: [
    sms(
      1,
      'Hey {{firstName}}, this is {{dealershipName}} — you reached out recently about the {{vehicleOfInterest}} and we wanted to follow up. Still looking, or did things change? (Reply STOP to opt out)',
      'Hey {{firstName}}, this is {{dealershipName}} — you reached out recently and we wanted to follow up. Still in the market, or did things change? (Reply STOP to opt out)',
      0,
    ),
    stopIfReplied(2),
    sms(
      3,
      'No pressure at all — just wanted to make sure you had everything you needed on the {{vehicleOfInterest}}. Happy to answer any questions over text.',
      'No pressure at all — just wanted to make sure you had everything you needed. Happy to answer any questions over text.',
      72,
    ),
    stopIfReplied(4),
    sms(
      5,
      "Last follow-up from us, {{firstName}}. If you're still looking, just reply and we'll get right back to you — no need to start over.",
      "Last follow-up from us. If you're still looking, just reply and we'll get right back to you.",
      120,
    ),
  ],

  /**
   * Bucket B — 30–59 days
   * About a month out. Acknowledge the gap lightly, check if timing is better.
   */
  b: [
    sms(
      1,
      'Hey {{firstName}}, this is {{dealershipName}} — you reached out about a month ago about the {{vehicleOfInterest}}. Still in the market, or did you end up going in a different direction? (Reply STOP to opt out)',
      'Hey {{firstName}}, this is {{dealershipName}} — you reached out about a month ago. Still in the market, or did you end up going a different direction? (Reply STOP to opt out)',
      0,
    ),
    stopIfReplied(2),
    sms(
      3,
      "Inventory and rates shift quickly — things may look a bit different now than they did a month ago. If you're still considering the {{vehicleOfInterest}}, happy to check what we have.",
      "Inventory and rates shift quickly — things may look a bit different now than they did a month ago. Still considering something? Happy to check what we have.",
      96,
    ),
    stopIfReplied(4),
    sms(
      5,
      "Closing the loop here, {{firstName}} — if things change down the road, just reply and we'll be here. No pressure either way.",
      "Closing the loop here — if things change down the road, just reply and we'll be here. No pressure either way.",
      120,
    ),
  ],

  /**
   * Bucket C — 60–89 days
   * Two to three months out. Lower-energy, open-ended, acknowledge the time.
   */
  c: [
    sms(
      1,
      "Hey {{firstName}}, it's been a couple months since you were in touch with {{dealershipName}} about the {{vehicleOfInterest}}. Still in the market, or has your situation changed? (Reply STOP to opt out)",
      "Hey {{firstName}}, it's been a couple months since you were in touch with {{dealershipName}}. Still in the market, or has your situation changed? (Reply STOP to opt out)",
      0,
    ),
    stopIfReplied(2),
    sms(
      3,
      "Totally understand if the timing isn't right. If you're still thinking about the {{vehicleOfInterest}} or something similar, happy to check what's available now.",
      "Totally understand if the timing isn't right. If you're still thinking about a vehicle, happy to see what's available now.",
      96,
    ),
    stopIfReplied(4),
    sms(
      5,
      "That's all from us, {{firstName}} — no pressure at all. Just reply whenever you're ready and we'll be here.",
      "That's all from us — no pressure. Just reply whenever you're ready and we'll be here.",
      120,
    ),
  ],

  /**
   * Bucket D — 90+ days
   * Three months or more. One genuine check-in, no chasing.
   * Shorter delay on step 3 — lead is stale, don't drag it out.
   */
  d: [
    sms(
      1,
      "Hey {{firstName}}, one last reach-out from {{dealershipName}}. You were looking at the {{vehicleOfInterest}} a while back — any chance you're still in the market? (Reply STOP to opt out)",
      "Hey {{firstName}}, one last reach-out from {{dealershipName}}. You were looking at vehicles a while back — any chance you're still in the market? (Reply STOP to opt out)",
      0,
    ),
    stopIfReplied(2),
    sms(
      3,
      "Inventory turns over quickly — there may be something that fits now. Worth a quick look at the {{vehicleOfInterest}} range, or something else entirely?",
      "Inventory turns over quickly — there may be something that fits better now. Worth a quick look?",
      72,
    ),
    stopIfReplied(4),
    sms(
      5,
      "Closing the loop here, {{firstName}}. If you ever want to revisit, just reply — no need to explain the gap. Take care.",
      "Closing the loop here. If you ever want to revisit, just reply — no need to explain the gap. Take care.",
      96,
    ),
  ],
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const tenantId =
    process.env.SEED_TENANT_ID ??
    process.env.VERIFY_TENANT_ID ??
    (await db.query.tenants.findFirst().then((t) => t?.id))

  if (!tenantId) {
    console.error('❌  No tenant found. Set SEED_TENANT_ID or run scripts/seed.ts first.')
    process.exit(1)
  }

  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  console.log(`\n🌱  Seeding pilot bucket workflow steps for: ${tenant?.name ?? tenantId}\n`)

  // Find all bucket workflows for this tenant
  const bucketWorkflows = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.tenantId, tenantId), isNotNull(workflows.ageBucket)))

  if (bucketWorkflows.length === 0) {
    console.log('⚠️   No age-bucket workflows found for this tenant.')
    console.log('     Import leads first so the age-classifier can create bucket workflows.\n')
    process.exit(0)
  }

  console.log(`  Found ${bucketWorkflows.length} bucket workflow(s):\n`)

  let seeded = 0

  for (const wf of bucketWorkflows) {
    const bucket = wf.ageBucket as string
    const steps = BUCKET_STEPS[bucket]

    if (!steps) {
      console.log(`  ⚠️   No step template for bucket "${bucket}" — skipping "${wf.name}"`)
      continue
    }

    // Wipe existing steps (idempotent re-seed)
    const deleted = await db
      .delete(workflowSteps)
      .where(eq(workflowSteps.workflowId, wf.id))

    // Insert fresh steps
    await db.insert(workflowSteps).values(
      steps.map((step) => ({
        workflowId: wf.id,
        position:   step.position,
        type:       step.type as 'send_sms' | 'condition',
        config:     step.config as never,
      }))
    )

    const smsCount  = steps.filter(s => s.type === 'send_sms').length
    const bucketLabel: Record<string, string> = {
      a: '14–29 days',
      b: '30–59 days',
      c: '60–89 days',
      d: '90+ days',
    }
    console.log(`  ✅  "${wf.name}" (bucket ${bucket} · ${bucketLabel[bucket] ?? bucket})`)
    console.log(`       → ${steps.length} steps inserted (${smsCount} SMS messages)`)
    seeded++
  }

  console.log(`\n✅  Done — ${seeded} workflow(s) seeded with message steps.\n`)
  console.log('Run the import/batch flow again to see previews on the batch review page.\n')
}

main()
  .catch((err) => { console.error('❌  Seeder failed:', err); process.exit(1) })
  .finally(() => process.exit(0))
