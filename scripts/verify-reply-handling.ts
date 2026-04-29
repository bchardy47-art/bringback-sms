/**
 * Reply-Handling Verification Script  (Phase 4)
 *
 * Proves the complete reply-handling pipeline works end-to-end:
 *
 *   1. STOP opts out and cancels enrollment
 *   2. "wrong number" cancels enrollment, classifies wrong_number, lead → dead
 *   3. "already bought" cancels enrollment, classifies already_bought
 *   4. "call me tomorrow" classifies callback_request, sets needsHumanHandoff=true
 *   5. "is it still available?" classifies question, sets needsHumanHandoff=true
 *   6. Any normal reply stamps lastCustomerReplyAt
 *   7. After reply, active step execution is blocked by send-guard (lead_replied)
 *
 * Strategy:
 *   Test 1 calls handleInbound() to exercise the full STOP path.
 *   Tests 2–7 call handleReply() directly (the Phase 4 core layer).
 *   Test 7 re-activates the cancelled enrollment so shouldStop() doesn't
 *     intercept it, then calls executeStep() — the lead_replied guard fires.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/verify-reply-handling.ts
 *
 * Prerequisites:
 *   - Postgres running with migrations applied (including 0004_reply_classification.sql)
 *   - SMS_LIVE_MODE not set
 *   - At least one tenant, active workflow, and phone number configured
 */

// Load .env.local when running via tsx directly
import { config } from 'dotenv'
config({ path: new URL('../.env.local', import.meta.url).pathname })

import { and, eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import {
  leads, conversations, optOuts, tenants,
  workflowEnrollments, workflowStepExecutions, workflows, phoneNumbers,
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
  lines.push(line.replace(/\x1b\[[0-9;]*m/g, ''))
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

let phoneCounter = 8000

function freshPhone(): string {
  return `+1555099${String(phoneCounter++).padStart(4, '0')}`
}

function freshProviderMessageId(): string {
  return `verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function seedEnrolledLead(tenantId: string, tag: string) {
  const [lead] = await db.insert(leads).values({
    tenantId,
    firstName: 'Reply',
    lastName: `Test-${tag}`,
    phone: freshPhone(),
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

async function deleteLead(leadId: string) {
  await db.delete(leads).where(eq(leads.id, leadId))
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // ── Resolve tenant, workflow, phone number ───────────────────────────────────
  const tenantId = process.env.VERIFY_TENANT_ID
    ?? (await db.query.tenants.findFirst().then(t => t?.id))
  if (!tenantId) {
    console.error('No tenant found. Seed a tenant first or set VERIFY_TENANT_ID.')
    process.exit(1)
  }

  if (process.env.SMS_LIVE_MODE === 'true') {
    console.error('ERROR: SMS_LIVE_MODE=true. This script must run with SMS sends blocked.')
    process.exit(1)
  }

  const workflow = await db.query.workflows.findFirst({
    where: and(eq(workflows.tenantId, tenantId), eq(workflows.isActive, true)),
  })
  if (!workflow) {
    console.error('No active workflow found. Create one first.')
    process.exit(1)
  }

  const tenantPhone = await db.query.phoneNumbers.findFirst({
    where: eq(phoneNumbers.tenantId, tenantId),
  })
  if (!tenantPhone) {
    console.error('No phone number found for tenant. Configure one first.')
    process.exit(1)
  }

  // ── Pause BullMQ so worker won't race with test mutations ────────────────────
  await workflowStepQueue.pause()

  head('REPLY-HANDLING VERIFICATION')
  log(`  Tenant:       ${tenantId}`)
  log(`  Workflow:     "${workflow.name}"`)
  log(`  Tenant phone: ${tenantPhone.number}`)
  log(`  SMS_LIVE_MODE: ${process.env.SMS_LIVE_MODE ?? 'not set ✓'}`)
  sep()
  log('')

  let passed = 0
  let failed = 0

  function record(ok: boolean) { ok ? passed++ : failed++ }

  // ── Test 1: STOP opts out and cancels enrollment ───────────────────────────
  head('1. STOP opts out + cancels enrollment')
  {
    let ok = false
    let leadId: string | undefined
    try {
      const lead = await seedEnrolledLead(tenantId, 'stop')
      leadId = lead.id

      // Create a conversation so the STOP path can find it (required for enrollment cancellation)
      await db.insert(conversations).values({
        tenantId,
        leadId: lead.id,
        tenantPhone: tenantPhone.number,
        leadPhone: lead.phone,
        status: 'open',
      }).onConflictDoUpdate({ target: conversations.leadId, set: { updatedAt: new Date() } })

      // Enroll so there's something to cancel
      await enrollLead(lead.id, workflow.id)

      const { handleInbound } = await import('../src/lib/messaging/inbound')
      await handleInbound({
        providerMessageId: freshProviderMessageId(),
        from: lead.phone,
        to: tenantPhone.number,
        body: 'STOP',
        receivedAt: new Date(),
      })

      // Verify opt-out
      const optOut = await db.query.optOuts.findFirst({
        where: and(eq(optOuts.tenantId, tenantId), eq(optOuts.phone, lead.phone)),
      })

      // Verify enrollment cancelled
      const enrollment = await db.query.workflowEnrollments.findFirst({
        where: eq(workflowEnrollments.leadId, lead.id),
      })

      // Verify conversation status
      const conv = await db.query.conversations.findFirst({
        where: and(eq(conversations.tenantId, tenantId), eq(conversations.leadPhone, lead.phone)),
      })

      // Verify lead state
      const updatedLead = await db.query.leads.findFirst({ where: eq(leads.id, lead.id) })

      const hasOptOut       = !!optOut
      const enrollCancelled = enrollment?.status === 'cancelled'
      const convOptedOut    = conv?.status === 'opted_out'
      const leadOptedOut    = updatedLead?.state === 'opted_out'

      if (hasOptOut && enrollCancelled && convOptedOut && leadOptedOut) {
        pass('STOP: opt-out record created', `phone=${lead.phone}`)
        pass('STOP: enrollment cancelled',   `stopReason=${enrollment?.stopReason}`)
        pass('STOP: conversation opted_out', `status=${conv?.status}`)
        pass('STOP: lead state → opted_out', `state=${updatedLead?.state}`)
        ok = true
      } else {
        if (!hasOptOut)       fail('STOP: opt-out record missing')
        if (!enrollCancelled) fail('STOP: enrollment not cancelled', `status=${enrollment?.status}`)
        if (!convOptedOut)    fail('STOP: conversation status wrong', `status=${conv?.status}`)
        if (!leadOptedOut)    fail('STOP: lead state wrong', `state=${updatedLead?.state}`)
      }

      // Cleanup: remove opt-out so phone can be reused, delete lead (cascades)
      await db.delete(optOuts).where(and(eq(optOuts.tenantId, tenantId), eq(optOuts.phone, lead.phone)))
    } catch (err) {
      fail('STOP: unexpected error', String(err))
    } finally {
      if (leadId) await deleteLead(leadId).catch(() => {})
    }
    record(ok)
  }

  // ── Test 2: wrong number → classification + lead → dead ───────────────────
  head('2. "wrong number" → wrong_number + lead dead + enrollment cancelled')
  {
    let ok = false
    let leadId: string | undefined
    try {
      const lead = await seedEnrolledLead(tenantId, 'wrong_number')
      leadId = lead.id
      const enrollmentId = await enrollLead(lead.id, workflow.id)

      const { handleReply } = await import('../src/lib/messaging/handle-reply')
      const result = await handleReply({ leadId: lead.id, body: 'I think you have the wrong number' })

      const enrollment = await db.query.workflowEnrollments.findFirst({
        where: eq(workflowEnrollments.id, enrollmentId),
      })
      const updatedLead = await db.query.leads.findFirst({ where: eq(leads.id, lead.id) })

      const classOk      = result.classification === 'wrong_number'
      const handoffOk    = result.needsHumanHandoff === false  // terminal — no handoff
      const cancelledOk  = result.enrollmentsCancelled === 1
      const enrollDbOk   = enrollment?.status === 'cancelled'
      const leadDeadOk   = updatedLead?.state === 'dead'
      const dbClassOk    = updatedLead?.replyClassification === 'wrong_number'

      if (classOk && handoffOk && cancelledOk && enrollDbOk && leadDeadOk && dbClassOk) {
        pass('classification=wrong_number', `reason="${result.classificationReason}"`)
        pass('needsHumanHandoff=false  (terminal classification)')
        pass('enrollmentsCancelled=1', `stopReason=${enrollment?.stopReason}`)
        pass('lead.state=dead')
        pass('lead.replyClassification=wrong_number  (stamped on lead row)')
        ok = true
      } else {
        if (!classOk)     fail('classification wrong', `got=${result.classification}`)
        if (!handoffOk)   fail('needsHumanHandoff wrong', `got=${result.needsHumanHandoff}`)
        if (!cancelledOk) fail('enrollmentsCancelled wrong', `got=${result.enrollmentsCancelled}`)
        if (!enrollDbOk)  fail('enrollment.status wrong', `got=${enrollment?.status}`)
        if (!leadDeadOk)  fail('lead.state wrong', `got=${updatedLead?.state}`)
        if (!dbClassOk)   fail('lead.replyClassification wrong', `got=${updatedLead?.replyClassification}`)
      }
    } catch (err) {
      fail('wrong_number: unexpected error', String(err))
    } finally {
      if (leadId) await deleteLead(leadId).catch(() => {})
    }
    record(ok)
  }

  // ── Test 3: already_bought → classification + enrollment cancelled ─────────
  head('3. "already bought" → already_bought + enrollment cancelled')
  {
    let ok = false
    let leadId: string | undefined
    try {
      const lead = await seedEnrolledLead(tenantId, 'already_bought')
      leadId = lead.id
      const enrollmentId = await enrollLead(lead.id, workflow.id)

      const { handleReply } = await import('../src/lib/messaging/handle-reply')
      const result = await handleReply({ leadId: lead.id, body: 'already bought a car last week' })

      const enrollment = await db.query.workflowEnrollments.findFirst({
        where: eq(workflowEnrollments.id, enrollmentId),
      })
      const updatedLead = await db.query.leads.findFirst({ where: eq(leads.id, lead.id) })

      const classOk     = result.classification === 'already_bought'
      const handoffOk   = result.needsHumanHandoff === false
      const cancelledOk = result.enrollmentsCancelled === 1
      const enrollDbOk  = enrollment?.status === 'cancelled'
      const dbClassOk   = updatedLead?.replyClassification === 'already_bought'

      if (classOk && handoffOk && cancelledOk && enrollDbOk && dbClassOk) {
        pass('classification=already_bought', `reason="${result.classificationReason}"`)
        pass('needsHumanHandoff=false  (terminal classification)')
        pass('enrollmentsCancelled=1', `stopReason=${enrollment?.stopReason}`)
        pass('lead.replyClassification=already_bought  (stamped on lead row)')
        ok = true
      } else {
        if (!classOk)     fail('classification wrong', `got=${result.classification}`)
        if (!handoffOk)   fail('needsHumanHandoff wrong', `got=${result.needsHumanHandoff}`)
        if (!cancelledOk) fail('enrollmentsCancelled wrong', `got=${result.enrollmentsCancelled}`)
        if (!enrollDbOk)  fail('enrollment.status wrong', `got=${enrollment?.status}`)
        if (!dbClassOk)   fail('lead.replyClassification wrong', `got=${updatedLead?.replyClassification}`)
      }
    } catch (err) {
      fail('already_bought: unexpected error', String(err))
    } finally {
      if (leadId) await deleteLead(leadId).catch(() => {})
    }
    record(ok)
  }

  // ── Test 4: callback_request + needsHumanHandoff ──────────────────────────
  head('4. "call me tomorrow" → callback_request + needsHumanHandoff=true')
  {
    let ok = false
    let leadId: string | undefined
    try {
      const lead = await seedEnrolledLead(tenantId, 'callback')
      leadId = lead.id
      await enrollLead(lead.id, workflow.id)

      const { handleReply } = await import('../src/lib/messaging/handle-reply')
      const result = await handleReply({ leadId: lead.id, body: 'call me tomorrow morning' })

      const updatedLead = await db.query.leads.findFirst({ where: eq(leads.id, lead.id) })

      const classOk   = result.classification === 'callback_request'
      const handoffOk = result.needsHumanHandoff === true
      const dbOk      = updatedLead?.needsHumanHandoff === true
                     && updatedLead?.replyClassification === 'callback_request'

      if (classOk && handoffOk && dbOk) {
        pass('classification=callback_request', `reason="${result.classificationReason}"`)
        pass('needsHumanHandoff=true  (warm lead — human action needed)')
        pass('lead.needsHumanHandoff=true  (stamped on lead row)')
        ok = true
      } else {
        if (!classOk)   fail('classification wrong', `got=${result.classification}`)
        if (!handoffOk) fail('needsHumanHandoff wrong', `got=${result.needsHumanHandoff}`)
        if (!dbOk)      fail('lead DB fields wrong',
          `classification=${updatedLead?.replyClassification} handoff=${updatedLead?.needsHumanHandoff}`)
      }
    } catch (err) {
      fail('callback_request: unexpected error', String(err))
    } finally {
      if (leadId) await deleteLead(leadId).catch(() => {})
    }
    record(ok)
  }

  // ── Test 5: question + needsHumanHandoff ─────────────────────────────────
  head('5. "is it still available?" → question + needsHumanHandoff=true')
  {
    let ok = false
    let leadId: string | undefined
    try {
      const lead = await seedEnrolledLead(tenantId, 'question')
      leadId = lead.id
      await enrollLead(lead.id, workflow.id)

      const { handleReply } = await import('../src/lib/messaging/handle-reply')
      const result = await handleReply({ leadId: lead.id, body: 'is it still available?' })

      const updatedLead = await db.query.leads.findFirst({ where: eq(leads.id, lead.id) })

      const classOk   = result.classification === 'question'
      const handoffOk = result.needsHumanHandoff === true
      const bodyOk    = updatedLead?.lastReplyBody === 'is it still available?'
      const dbClassOk = updatedLead?.replyClassification === 'question'

      if (classOk && handoffOk && bodyOk && dbClassOk) {
        pass('classification=question', `reason="${result.classificationReason}"  (? catch-all fires before "interested" — two-pass ordering correct)`)
        pass('needsHumanHandoff=true')
        pass('lead.lastReplyBody stamped correctly')
        ok = true
      } else {
        if (!classOk)   fail('classification wrong', `got=${result.classification}`)
        if (!handoffOk) fail('needsHumanHandoff wrong', `got=${result.needsHumanHandoff}`)
        if (!bodyOk)    fail('lastReplyBody wrong', `got="${updatedLead?.lastReplyBody}"`)
        if (!dbClassOk) fail('lead.replyClassification wrong', `got=${updatedLead?.replyClassification}`)
      }
    } catch (err) {
      fail('question: unexpected error', String(err))
    } finally {
      if (leadId) await deleteLead(leadId).catch(() => {})
    }
    record(ok)
  }

  // ── Test 6: any reply stamps lastCustomerReplyAt ──────────────────────────
  head('6. Normal reply stamps lastCustomerReplyAt')
  {
    let ok = false
    let leadId: string | undefined
    try {
      const lead = await seedEnrolledLead(tenantId, 'stamp_reply_at')
      leadId = lead.id
      await enrollLead(lead.id, workflow.id)

      const before = new Date()

      const { handleReply } = await import('../src/lib/messaging/handle-reply')
      await handleReply({ leadId: lead.id, body: 'sounds great' })

      const updatedLead = await db.query.leads.findFirst({ where: eq(leads.id, lead.id) })
      const replyAt = updatedLead?.lastCustomerReplyAt

      const stamped    = !!replyAt
      const afterBefore = stamped && replyAt! >= before
      const bodyStamped = updatedLead?.lastReplyBody === 'sounds great'

      if (stamped && afterBefore && bodyStamped) {
        pass('lastCustomerReplyAt stamped', `value=${replyAt!.toISOString()}`)
        pass('lastReplyBody stamped', `"${updatedLead?.lastReplyBody}"`)
        ok = true
      } else {
        if (!stamped)      fail('lastCustomerReplyAt is null')
        if (!afterBefore)  fail('lastCustomerReplyAt is before the reply was processed',
          `replyAt=${replyAt?.toISOString()} before=${before.toISOString()}`)
        if (!bodyStamped)  fail('lastReplyBody wrong', `got="${updatedLead?.lastReplyBody}"`)
      }
    } catch (err) {
      fail('stamp_reply_at: unexpected error', String(err))
    } finally {
      if (leadId) await deleteLead(leadId).catch(() => {})
    }
    record(ok)
  }

  // ── Test 7: send-guard blocks lead_replied after reply ────────────────────
  //
  // Chain: enroll → handleReply (stamps lastCustomerReplyAt, cancels enrollment)
  //        → re-activate enrollment (so shouldStop won't intercept first)
  //        → executeStep() → send-guard sees lead_replied → step skipped
  //
  // This proves that handleReply's timestamp stamp is the causal trigger for
  // the send-guard's lead_replied check.
  head('7. Reply → send-guard blocks future step execution (lead_replied)')
  {
    let ok = false
    let leadId: string | undefined
    try {
      const lead = await seedEnrolledLead(tenantId, 'guard_lead_replied')
      leadId = lead.id
      const enrollmentId = await enrollLead(lead.id, workflow.id)
      const stepExec = await getFirstStepExecution(enrollmentId)

      // Simulate the reply (stamps lastCustomerReplyAt, cancels enrollment)
      const { handleReply } = await import('../src/lib/messaging/handle-reply')
      await handleReply({ leadId: lead.id, body: 'sounds good' })

      // Confirm lastCustomerReplyAt was stamped AFTER scheduledAt
      const afterReply = await db.query.leads.findFirst({ where: eq(leads.id, lead.id) })
      const replyAt = afterReply?.lastCustomerReplyAt
      const replyAfterSchedule = replyAt && replyAt > stepExec.scheduledAt

      if (!replyAfterSchedule) {
        fail('precondition: lastCustomerReplyAt should be > scheduledAt',
          `replyAt=${replyAt?.toISOString()} scheduledAt=${stepExec.scheduledAt.toISOString()}`)
        record(false)
        if (leadId) await deleteLead(leadId).catch(() => {})
        return
      }

      // Re-activate the enrollment AND reset lead state to 'enrolled' so shouldStop()
      // doesn't intercept via 'lead_responded' before the send guard can check 'lead_replied'.
      // (shouldStop fires on lead.state === 'responded'; reverting the state lets the guard run.)
      await db.update(workflowEnrollments)
        .set({ status: 'active', completedAt: null, stopReason: null, stoppedAt: null })
        .where(eq(workflowEnrollments.id, enrollmentId))

      await db.update(leads)
        .set({ state: 'enrolled' })
        .where(eq(leads.id, lead.id))

      // Reset the step execution status to pending so executeStep can run it
      await db.update(workflowStepExecutions)
        .set({ status: 'pending' })
        .where(eq(workflowStepExecutions.id, stepExec.id))

      // Run the step directly — no BullMQ worker, fully synchronous
      const { executeStep } = await import('../src/lib/engine/executor')
      await executeStep(stepExec.id)

      // Verify: step skipped with lead_replied
      const updatedExec = await db.query.workflowStepExecutions.findFirst({
        where: eq(workflowStepExecutions.id, stepExec.id),
      })
      const { messages: msgs } = await import('../src/lib/db/schema')
      const auditMsg = await db.query.messages.findFirst({
        where: eq(msgs.stepExecutionId, stepExec.id),
      })

      const stepSkipped    = updatedExec?.status === 'skipped'
      const correctReason  = auditMsg?.skipReason === 'lead_replied'
      const hasTimestamp   = !!auditMsg?.skippedAt

      if (stepSkipped && correctReason && hasTimestamp) {
        pass('precondition: lastCustomerReplyAt > scheduledAt',
          `replyAt=${replyAt!.toISOString().slice(0, 19)}  scheduledAt=${stepExec.scheduledAt.toISOString().slice(0, 19)}`)
        pass('step.status=skipped after reply')
        pass('skip_reason=lead_replied', `skipped_at=${auditMsg!.skippedAt!.toISOString().slice(0, 19)}`)
        ok = true
      } else {
        if (!stepSkipped)   fail('step.status wrong', `got=${updatedExec?.status}`)
        if (!correctReason) fail('skip_reason wrong', `got=${auditMsg?.skipReason}`)
        if (!hasTimestamp)  fail('skipped_at is null')
      }
    } catch (err) {
      fail('guard_lead_replied: unexpected error', String(err))
    } finally {
      if (leadId) await deleteLead(leadId).catch(() => {})
    }
    record(ok)
  }

  // ── Resume queue ──────────────────────────────────────────────────────────
  await workflowStepQueue.resume()
  log('')
  log(`  Queue resumed`)

  // ── Summary ───────────────────────────────────────────────────────────────
  head('SUMMARY')
  const color = failed === 0 ? '\x1b[32m' : '\x1b[31m'
  log(`  ${color}${BOLD}${passed} passed  |  ${failed} failed${RESET}`)
  sep()
  log('')

  const outPath = '/tmp/dlr-reply-handling-verify.txt'
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
