/**
 * Fix: "14-Day Stale Lead Revival" opt-out footer
 *
 * The seeded workflow embeds "Reply STOP to opt out." inline in each message
 * body, but never sets config.optOutFooter. The pre-live checklist (and Go/No-Go
 * report) require optOutFooter to be explicitly set on at least one send_sms step.
 *
 * This script:
 *   1. Finds the "14-Day Stale Lead Revival" workflow.
 *   2. For each send_sms step, strips the trailing opt-out text from the template
 *      body and sets optOutFooter = "Reply STOP to opt out." in the config.
 *   3. Saves the updated config back to the DB.
 *
 * Safe to re-run — idempotent (won't double-add the footer).
 *
 * Usage:
 *   npx tsx scripts/fix-workflow-opt-out.ts
 */

import { config } from 'dotenv'
config({ path: new URL('../.env.local', import.meta.url).pathname })

import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { workflows, workflowSteps } from '../src/lib/db/schema'
import type { SendSmsConfig, StepConfig } from '../src/lib/db/schema'

const OPT_OUT_FOOTER = 'Reply STOP to opt out.'

// Patterns to strip from message bodies (trailing opt-out language)
const TRAILING_OPT_OUT_PATTERNS = [
  / Reply STOP to opt out\.$/,
  / \(Reply STOP to opt out\)\.?$/,
  / Reply STOP to opt out\.$/, // with space before
]

function stripTrailingOptOut(body: string): string {
  let cleaned = body.trim()
  for (const pattern of TRAILING_OPT_OUT_PATTERNS) {
    cleaned = cleaned.replace(pattern, '').trim()
  }
  return cleaned
}

async function main() {
  console.log('\n🔧 Fixing opt-out footer on "14-Day Stale Lead Revival" workflow...\n')

  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.name, '14-Day Stale Lead Revival'),
    with: { steps: { orderBy: [workflowSteps.position] } },
  })

  if (!workflow) {
    console.error('❌ Workflow "14-Day Stale Lead Revival" not found. Has seed.ts been run?')
    process.exit(1)
  }

  console.log(`✅ Found workflow: "${workflow.name}" (${workflow.id})`)
  console.log(`   requiresOptOutLanguage: ${workflow.requiresOptOutLanguage}`)
  console.log(`   Steps: ${workflow.steps.length}\n`)

  let fixedCount = 0

  for (const step of workflow.steps) {
    if (step.type !== 'send_sms') continue

    const cfg = step.config as SendSmsConfig

    // Already has footer set — skip
    if (cfg.optOutFooter?.trim()) {
      console.log(`  Step ${step.position}: optOutFooter already set — skipping.`)
      continue
    }

    const originalBody = cfg.template ?? ''
    const cleanedBody  = stripTrailingOptOut(originalBody)

    console.log(`  Step ${step.position} — BEFORE: ${originalBody.slice(-60)}`)
    console.log(`  Step ${step.position} — AFTER:  ${cleanedBody.slice(-40)} + [footer]`)

    const newConfig: SendSmsConfig = {
      ...cfg,
      template:     cleanedBody,
      optOutFooter: OPT_OUT_FOOTER,
    }

    await db
      .update(workflowSteps)
      .set({ config: newConfig as StepConfig })
      .where(eq(workflowSteps.id, step.id))

    fixedCount++
    console.log(`  ✅ Step ${step.position} updated.\n`)
  }

  if (fixedCount === 0) {
    console.log('ℹ️  No steps needed updating — all send_sms steps already have optOutFooter set.')
  } else {
    console.log(`\n✅ Fixed ${fixedCount} send_sms step(s).`)
    console.log('   The opt-out footer is now properly set in config.optOutFooter')
    console.log('   and removed from the inline template body.')
    console.log('\n   Next step: re-run Go/No-Go and then approve the workflow via the Readiness panel.')
  }

  process.exit(0)
}

main().catch(err => {
  console.error('❌ Fix failed:', err)
  process.exit(1)
})
