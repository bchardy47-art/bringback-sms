/**
 * Send-Guard Verification Script
 *
 * Proves the send-time guard catches conditions that arise AFTER enrollment.
 *
 * Strategy — deterministic, no race conditions:
 *   1. Seed a clean lead and enroll it (gets a step execution in the DB)
 *   2. Apply the blocking condition to the lead/tenant/enrollment
 *   3. Call executeStep() directly — no BullMQ, no timing dependency
 *   4. Verify the step is marked skipped with the correct guard reason
 *   5. Verify a message audit row exists with skip_reason + skipped_at
 *   6. Restore any mutations, clean up the lead
 *
 * Test cases:
 *   test_lead             — set isTest=true after enrollment
 *   do_not_automate       — set doNotAutomate=true after enrollment
 *   opted_out             — add opt-out record after enrollment
 *   invalid_phone         — corrupt phone after enrollment
 *   tenant_paused         — pause tenant automation after enrollment
 *   enrollment_not_active — cancel enrollment after it's created
 *   lead_replied          — set lastCustomerReplyAt after step scheduled
 *   recent_human_contact  — set lastHumanContactAt to now after enrollment
 *   sms_not_live          — no mutation; SMS_LIVE_MODE not set is the guard
 *   step_already_sent     — call runSendGuard directly with a 'sent' message
 *
 * Usage:
 *   npx tsx scripts/verify-send-guard.ts
 *
 * Prerequisites:
 *   - Postgres running (worker NOT required — executeStep is called directly)
 *   - SMS_LIVE_MODE not set
 */

// Load .env.local so DATABASE_URL etc. are available when running via tsx directly
import { config } from 'dotenv'
config({ path: new URL('../.env.local', import.meta.url).pathname })

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../src/lib/db'
import {
  leads, messages, conversations, optOuts, tenants,
  workflowEnrollments, workflowStepExecutions, workflows,
} from '../src/lib/db/schema'
import { workflowStepQueue } from '../src/lib/queue/queues'

// ── Colours ───────────────────────────────────────────────────────────────────
const GREEN = '\x1b[32m✓\x1b[0m'
const RED   = '\x1b[31m✗\x1b[0m'
const DIM   = '\x1b[2m'
const RESET = '\x1b[0m'
const BOLD  = '\x1b[1m'

const lines: string[] = []

function log(line: string) {
  console.log(line)
  lines.push(line.replace(/\x1b\[[0-9;]*m/g, '')) // strip colours for file
}
function pass(label: string, detail?: string) {
  log(`  ${GREEN} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`)
}
function fail(label: string, detail?: string) {
  log(`  ${RED} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`)
}
function sep()  { log('────────────────────────────────────────────────────') }
function head(t: string) { log(''); sep(); log(`  ${BOLD}${t}${RESET}`); sep() }

// ── Helpers ───────────────────────────────────────────────────────────────────

async function checkDb(tenantId: string): Promise<boolean> {
  try {
    await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
    return true
  } catch {
    return false
  }
}

async function seedLead(tenantId: string, tag: string) {
  const [lead] = await db.insert(leads).values({
    tenantId,
    firstName: 'Guard',
    lastName: `Test-${tag}`,
    phone: `+1555092${String(Math.floor(Math.random() * 9000) + 1000)}`,
    state: 'revival_eligible',
    isTest: false,
    doNotAutomate: false,
    crmSource: 'csv',
  }).returning()
  return lead
}

async function enrollLead(leadId: string, workflowId: string) {
  const { enrollLead: enroll } = await import('../src/lib/engine/enroll')
  const result = await enroll(leadId, workflowId)
  if ('skipped' in result) throw new Error(`Enrollment skipped: ${result.skipped}`)
  return result.enrollmentId
}

async function getFirstStepExecution(enrollmentId: string) {
  const exec = await db.query.workflowStepExecutions.findFirst({
    where: eq(workflowStepExecutions.enrollmentId, enrollmentId),
    orderBy: (t, { asc }) => [asc(t.scheduledAt)],
  })
  if (!exec) throw new Error(`No step execution found for enrollment ${enrollmentId}`)
  return exec
}

async function runStep(stepExecutionId: string) {
  const { executeStep } = await import('../src/lib/engine/executor')
  await executeStep(stepExecutionId)
}

async function getMessageForStep(stepExecutionId: string) {
  return db.query.messages.findFirst({
    where: eq(messages.stepExecutionId, stepExecutionId),
  })
}

async function getStepExecution(id: string) {
  return db.query.workflowStepExecutions.findFirst({
    where: eq(workflowStepExecutions.id, id),
  })
}

// ── Verify a single scenario ──────────────────────────────────────────────────

async function verify(
  label: string,
  expectedReason: string,
  run: () => Promise<{ stepExecutionId: string; cleanup: () => Promise<void> }>
) {
  let cleanup: (() => Promise<void>) | undefined

  try {
    const result = await run()
    cleanup = result.cleanup

    // Check step execution status
    const exec = await getStepExecution(result.stepExecutionId)
    const msg  = await getMessageForStep(result.stepExecutionId)

    const stepSkipped = exec?.status === 'skipped'
    const hasAuditRow = !!msg
    const correctReason = msg?.skipReason === expectedReason
    const hasTimestamp  = !!msg?.skippedAt

    if (stepSkipped && hasAuditRow && correctReason && hasTimestamp) {
      pass(label, `skip_reason=${msg!.skipReason}  step=${exec!.status}  skipped_at=${msg!.skippedAt!.toISOString().slice(0, 19)}`)
    } else {
      const problems: string[] = []
      if (!stepSkipped)   problems.push(`step.status=${exec?.status ?? 'null'} (expected skipped)`)
      if (!hasAuditRow)   problems.push('no message audit row')
      if (!correctReason) problems.push(`skip_reason=${msg?.skipReason ?? 'null'} (expected ${expectedReason})`)
      if (!hasTimestamp)  problems.push('skipped_at is null')
      fail(label, problems.join(' | '))
    }

    return stepSkipped && hasAuditRow && correctReason && hasTimestamp
  } catch (err) {
    fail(label, `Error: ${err instanceof Error ? err.message : String(err)}`)
    return false
  } finally {
    try { await cleanup?.() } catch { /* ignore cleanup errors */ }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // ── Resolve context ─────────────────────────────────────────────────────────
  const tenantId = process.env.VERIFY_TENANT_ID
    ?? (await db.query.tenants.findFirst().then(t => t?.id))
  if (!tenantId) {
    console.error('No tenant found. Seed a tenant first or set VERIFY_TENANT_ID.')
    process.exit(1)
  }

  if (process.env.SMS_LIVE_MODE === 'true') {
    console.error('ERROR: SMS_LIVE_MODE=true. This script requires sends to be blocked.')
    process.exit(1)
  }

  // DB connectivity check
  if (!await checkDb(tenantId)) {
    console.error('ERROR: Cannot connect to the database. Is Postgres running?')
    process.exit(1)
  }

  const workflow = await db.query.workflows.findFirst({
    where: and(eq(workflows.tenantId, tenantId), eq(workflows.isActive, true)),
  })
  if (!workflow) {
    console.error('No active workflow found. Create one first.')
    process.exit(1)
  }

  // ── Pause the BullMQ queue so the worker can't race with our mutations ───────
  await workflowStepQueue.pause()
  log('')
  log(`  Queue paused — worker will not process jobs during this run`)

  head('SEND-GUARD VERIFICATION')
  log(`  Tenant:        ${tenantId}`)
  log(`  Workflow:      "${workflow.name}"`)
  log(`  SMS_LIVE_MODE: ${process.env.SMS_LIVE_MODE ?? 'not set ✓'}`)
  log(`  Note:          Worker NOT required — executeStep called directly`)
  sep()
  log('')

  let passed = 0
  let failed = 0

  function record(ok: boolean) { ok ? passed++ : failed++ }

  // ── 1. test_lead ────────────────────────────────────────────────────────────
  record(await verify('test_lead: isTest set after enrollment', 'test_lead', async () => {
    const lead = await seedLead(tenantId, 'test_lead')
    const enrollmentId = await enrollLead(lead.id, workflow.id)
    const exec = await getFirstStepExecution(enrollmentId)
    // Apply block AFTER enrollment
    await db.update(leads).set({ isTest: true }).where(eq(leads.id, lead.id))
    await runStep(exec.id)
    return {
      stepExecutionId: exec.id,
      cleanup: async () => { await db.delete(leads).where(eq(leads.id, lead.id)) },
    }
  }))

  // ── 2. do_not_automate ──────────────────────────────────────────────────────
  record(await verify('do_not_automate: flag set after enrollment', 'do_not_automate', async () => {
    const lead = await seedLead(tenantId, 'do_not_automate')
    const enrollmentId = await enrollLead(lead.id, workflow.id)
    const exec = await getFirstStepExecution(enrollmentId)
    await db.update(leads).set({ doNotAutomate: true }).where(eq(leads.id, lead.id))
    await runStep(exec.id)
    return {
      stepExecutionId: exec.id,
      cleanup: async () => { await db.delete(leads).where(eq(leads.id, lead.id)) },
    }
  }))

  // ── 3. opted_out ────────────────────────────────────────────────────────────
  record(await verify('opted_out: opt-out record added after enrollment', 'opted_out', async () => {
    const lead = await seedLead(tenantId, 'opted_out')
    const enrollmentId = await enrollLead(lead.id, workflow.id)
    const exec = await getFirstStepExecution(enrollmentId)
    await db.insert(optOuts).values({ tenantId, phone: lead.phone, source: 'verify_script' }).onConflictDoNothing()
    await runStep(exec.id)
    return {
      stepExecutionId: exec.id,
      cleanup: async () => {
        await db.delete(optOuts).where(and(eq(optOuts.tenantId, tenantId), eq(optOuts.phone, lead.phone)))
        await db.delete(leads).where(eq(leads.id, lead.id))
      },
    }
  }))

  // ── 4. invalid_phone ────────────────────────────────────────────────────────
  record(await verify('invalid_phone: phone corrupted after enrollment', 'invalid_phone', async () => {
    const lead = await seedLead(tenantId, 'invalid_phone')
    const enrollmentId = await enrollLead(lead.id, workflow.id)
    const exec = await getFirstStepExecution(enrollmentId)
    await db.update(leads).set({ phone: '555-BAD' }).where(eq(leads.id, lead.id))
    await runStep(exec.id)
    return {
      stepExecutionId: exec.id,
      cleanup: async () => { await db.delete(leads).where(eq(leads.id, lead.id)) },
    }
  }))

  // ── 5. tenant_paused ────────────────────────────────────────────────────────
  record(await verify('tenant_paused: automation paused after enrollment', 'tenant_paused', async () => {
    const lead = await seedLead(tenantId, 'tenant_paused')
    const enrollmentId = await enrollLead(lead.id, workflow.id)
    const exec = await getFirstStepExecution(enrollmentId)
    await db.update(tenants).set({ automationPaused: true }).where(eq(tenants.id, tenantId))
    await runStep(exec.id)
    return {
      stepExecutionId: exec.id,
      cleanup: async () => {
        await db.update(tenants).set({ automationPaused: false }).where(eq(tenants.id, tenantId))
        await db.delete(leads).where(eq(leads.id, lead.id))
      },
    }
  }))

  // ── 6. enrollment_not_active ──────────────────────────────────────────────────
  //
  // NOTE: The executor's shouldStop() catches cancelled enrollments BEFORE the
  // send guard runs, so no guard audit row is written. We verify the step is
  // marked 'skipped' — that's the correct observable behaviour.
  {
    let ok = false
    try {
      const lead = await seedLead(tenantId, 'enrollment_not_active')
      const enrollmentId = await enrollLead(lead.id, workflow.id)
      const exec = await getFirstStepExecution(enrollmentId)
      await db.update(workflowEnrollments)
        .set({ status: 'cancelled', completedAt: new Date() })
        .where(eq(workflowEnrollments.id, enrollmentId))
      await runStep(exec.id)
      const stepExec = await getStepExecution(exec.id)
      ok = stepExec?.status === 'skipped'
      if (ok) {
        pass('enrollment_not_active: cancelled enrollment → step skipped', `step=${stepExec!.status}  (shouldStop fires before guard — no audit row expected)`)
      } else {
        fail('enrollment_not_active: cancelled enrollment → step skipped', `step=${stepExec?.status ?? 'null'} (expected skipped)`)
      }
      await db.delete(leads).where(eq(leads.id, lead.id))
    } catch (err) {
      fail('enrollment_not_active: cancelled enrollment → step skipped', `Error: ${err instanceof Error ? err.message : String(err)}`)
    }
    record(ok)
  }

  // ── 7. lead_replied ─────────────────────────────────────────────────────────
  record(await verify('lead_replied: reply timestamp set after step scheduled', 'lead_replied', async () => {
    const lead = await seedLead(tenantId, 'lead_replied')
    const enrollmentId = await enrollLead(lead.id, workflow.id)
    const exec = await getFirstStepExecution(enrollmentId)
    // Set reply timestamp to AFTER the step was scheduled
    const replyTime = new Date(exec.scheduledAt.getTime() + 60_000)
    await db.update(leads).set({ lastCustomerReplyAt: replyTime }).where(eq(leads.id, lead.id))
    await runStep(exec.id)
    return {
      stepExecutionId: exec.id,
      cleanup: async () => { await db.delete(leads).where(eq(leads.id, lead.id)) },
    }
  }))

  // ── 8. recent_human_contact ─────────────────────────────────────────────────
  record(await verify('recent_human_contact: human contact set within pause window', 'recent_human_contact', async () => {
    const lead = await seedLead(tenantId, 'recent_human_contact')
    const enrollmentId = await enrollLead(lead.id, workflow.id)
    const exec = await getFirstStepExecution(enrollmentId)
    // Set human contact to 1 minute ago — within the default 24h window
    const humanTime = new Date(Date.now() - 60_000)
    await db.update(leads).set({ lastHumanContactAt: humanTime }).where(eq(leads.id, lead.id))
    await runStep(exec.id)
    return {
      stepExecutionId: exec.id,
      cleanup: async () => { await db.delete(leads).where(eq(leads.id, lead.id)) },
    }
  }))

  // ── 9. sms_not_live ─────────────────────────────────────────────────────────
  record(await verify('sms_not_live: clean lead blocked only by env guard', 'sms_not_live', async () => {
    const lead = await seedLead(tenantId, 'sms_not_live')
    const enrollmentId = await enrollLead(lead.id, workflow.id)
    const exec = await getFirstStepExecution(enrollmentId)
    // No mutation needed — SMS_LIVE_MODE not set is the guard
    await runStep(exec.id)
    return {
      stepExecutionId: exec.id,
      cleanup: async () => { await db.delete(leads).where(eq(leads.id, lead.id)) },
    }
  }))

  // ── 10. step_already_sent (direct guard call) ────────────────────────────────
  log('')
  log(`  ${DIM}── step_already_sent: idempotency (direct guard call) ──${RESET}`)
  log('')

  try {
    const { runSendGuard } = await import('../src/lib/engine/send-guard')
    const lead = await seedLead(tenantId, 'step_already_sent')
    const enrollmentId = await enrollLead(lead.id, workflow.id)
    const exec = await getFirstStepExecution(enrollmentId)
    const enrollment = (await db.query.workflowEnrollments.findFirst({
      where: eq(workflowEnrollments.id, enrollmentId),
    }))!

    // Create a fake 'sent' message tied to this step execution
    const phoneNumber = await db.query.phoneNumbers.findFirst({ where: eq(require('../src/lib/db/schema').phoneNumbers.tenantId, tenantId) })
    if (!phoneNumber) throw new Error('No phone number configured for tenant')

    const [conv] = await db.insert(conversations).values({
      tenantId, leadId: lead.id, tenantPhone: phoneNumber.number, leadPhone: lead.phone,
    }).onConflictDoUpdate({ target: conversations.leadId, set: { updatedAt: new Date() } }).returning()

    await db.insert(messages).values({
      conversationId: conv.id,
      direction: 'outbound',
      body: 'Test message',
      status: 'sent',
      stepExecutionId: exec.id,
      sentAt: new Date(),
    }).onConflictDoNothing()

    const result = await runSendGuard({
      lead: (await db.query.leads.findFirst({ where: eq(leads.id, lead.id) }))!,
      enrollment,
      stepExecutionId: exec.id,
      scheduledAt: exec.scheduledAt,
      workflowId: enrollment.workflowId,
    })

    await db.delete(leads).where(eq(leads.id, lead.id))

    if (!result.allowed && result.reason === 'step_already_sent') {
      pass('step_already_sent: duplicate step blocked by guard', `reason=${result.reason}`)
      passed++
    } else {
      fail('step_already_sent: duplicate step blocked by guard', `allowed=${result.allowed} reason=${result.reason}`)
      failed++
    }
  } catch (err) {
    fail('step_already_sent: duplicate step blocked by guard', `Error: ${err instanceof Error ? err.message : String(err)}`)
    failed++
  }

  // ── Resume queue ────────────────────────────────────────────────────────────
  await workflowStepQueue.resume()
  log('')
  log(`  Queue resumed`)

  // ── Summary ─────────────────────────────────────────────────────────────────
  head('SUMMARY')
  const color = failed === 0 ? '\x1b[32m' : '\x1b[31m'
  log(`  ${color}${BOLD}${passed} passed  |  ${failed} failed${RESET}`)
  sep()
  log('')

  // ── Save to file ─────────────────────────────────────────────────────────────
  const outPath = '/tmp/dlr-send-guard-verify.txt'
  const { writeFileSync } = await import('fs')
  writeFileSync(outPath, lines.join('\n') + '\n')
  console.log(`${DIM}Full output saved to ${outPath}${RESET}\n`)

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(async err => {
  console.error('\nVerification crashed:', err)
  try { await workflowStepQueue.resume() } catch { /* best effort */ }
  process.exit(1)
})
