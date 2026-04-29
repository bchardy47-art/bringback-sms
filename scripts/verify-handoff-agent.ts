/**
 * Handoff-Agent Verification Script  (Phase 5)
 *
 * Proves the handoff task pipeline works end-to-end:
 *
 *   1. "call me tomorrow"         → high-priority callback_request sales task
 *      └─ replayed immediately    → no duplicate (idempotent)
 *   2. "is it still available?"   → normal-priority question task + recommended reply
 *   3. "want to test drive it"    → urgent appointment_request task
 *   4. "I'm pissed, stop texting" → urgent angry_or_complaint escalation task,
 *                                   no recommended reply, task_type=escalation
 *   5. Existing open task          → createHandoffTask returns duplicate_open_task
 *   6. Human resolves task         → status=resolved, resolvedAt set,
 *                                   lead.lastHumanContactAt stamped
 *
 * Strategy:
 *   Tests 1–5 call createHandoffTask() directly (no need for full inbound setup).
 *   Test 6 calls resolveHandoffTask() on the task created in test 1.
 *   All leads are cleaned up after each test.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/verify-handoff-agent.ts
 *
 * Prerequisites:
 *   - Postgres running with migration 0005_handoff_tasks.sql applied
 *   - At least one tenant configured
 */

import { config } from 'dotenv'
config({ path: new URL('../.env.local', import.meta.url).pathname })

import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { leads, tenants, handoffTasks } from '../src/lib/db/schema'
import {
  createHandoffTask,
  resolveHandoffTask,
} from '../src/lib/handoff/handoff-agent'

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

let phoneCounter = 7000

function freshPhone(): string {
  return `+1555088${String(phoneCounter++).padStart(4, '0')}`
}

async function seedLead(tenantId: string, tag: string, vehicle?: string) {
  const [lead] = await db.insert(leads).values({
    tenantId,
    firstName: 'Handoff',
    lastName: `Test-${tag}`,
    phone: freshPhone(),
    state: 'responded',  // post-reply state
    vehicleOfInterest: vehicle ?? '2024 Toyota Camry',
    isTest: false,
    doNotAutomate: false,
    crmSource: 'csv',
  }).returning()
  return lead
}

async function deleteLead(leadId: string) {
  await db.delete(leads).where(eq(leads.id, leadId)).catch(() => {})
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // ── Resolve tenant ───────────────────────────────────────────────────────────
  const tenantId = process.env.VERIFY_TENANT_ID
    ?? (await db.query.tenants.findFirst().then(t => t?.id))
  if (!tenantId) {
    console.error('No tenant found. Seed a tenant first or set VERIFY_TENANT_ID.')
    process.exit(1)
  }

  head('HANDOFF-AGENT VERIFICATION')
  log(`  Tenant: ${tenantId}`)
  sep()
  log('')

  let passed = 0
  let failed = 0
  function record(ok: boolean) { ok ? passed++ : failed++ }

  // ── Test 1: callback_request → high-priority sales task + dedup ─────────────
  head('1. "call me tomorrow" → high-priority callback_request task + no duplicate on replay')
  let test1TaskId: string | undefined
  let test1LeadId: string | undefined
  {
    let ok = false
    try {
      const lead = await seedLead(tenantId, 'callback')
      test1LeadId = lead.id

      const result = await createHandoffTask({
        tenantId,
        leadId: lead.id,
        classification: 'callback_request',
        customerMessage: 'call me tomorrow morning',
      })

      if (!result.created) {
        fail('task created', `got created=false reason=${result.reason}`)
        record(false)
        await deleteLead(lead.id)
        return
      }

      test1TaskId = result.task.id

      const classOk    = result.task.classification === 'callback_request'
      const priorityOk = result.task.priority === 'high'
      const typeOk     = result.task.taskType === 'sales'
      const statusOk   = result.task.status === 'open'
      const msgOk      = result.task.customerMessage === 'call me tomorrow morning'
      const actionOk   = result.task.recommendedNextAction === 'Call the customer back as requested.'
      const replyOk    = result.task.recommendedReply?.includes(lead.firstName) === true

      if (classOk && priorityOk && typeOk && statusOk && msgOk && actionOk && replyOk) {
        pass('classification=callback_request')
        pass('priority=high')
        pass('taskType=sales')
        pass('status=open')
        pass('customerMessage stored')
        pass('recommendedNextAction correct')
        pass('recommendedReply contains lead first name', `"${result.task.recommendedReply}"`)
        ok = true
      } else {
        if (!classOk)    fail('classification wrong',     `got=${result.task.classification}`)
        if (!priorityOk) fail('priority wrong',           `got=${result.task.priority}`)
        if (!typeOk)     fail('taskType wrong',           `got=${result.task.taskType}`)
        if (!statusOk)   fail('status wrong',             `got=${result.task.status}`)
        if (!msgOk)      fail('customerMessage wrong',    `got="${result.task.customerMessage}"`)
        if (!actionOk)   fail('recommendedNextAction wrong', `got="${result.task.recommendedNextAction}"`)
        if (!replyOk)    fail('recommendedReply wrong',   `got="${result.task.recommendedReply}"`)
      }

      // ── Dedup: replay same lead → no new task ──
      log('')
      log(`  ${DIM}── Replay: same lead → duplicate_open_task ──${RESET}`)
      log('')
      const replay = await createHandoffTask({
        tenantId,
        leadId: lead.id,
        classification: 'callback_request',
        customerMessage: 'call me tomorrow morning',
      })

      const dupOk  = !replay.created && replay.reason === 'duplicate_open_task'
      const idOk   = !replay.created && replay.reason === 'duplicate_open_task' && replay.existingTaskId === test1TaskId

      // Count tasks for lead — should still be exactly 1
      const taskCount = await db.query.handoffTasks.findMany({
        where: eq(handoffTasks.leadId, lead.id),
      })

      const countOk = taskCount.length === 1

      if (dupOk && idOk && countOk) {
        pass('duplicate suppressed: reason=duplicate_open_task')
        pass('existingTaskId matches original task')
        pass('only 1 task row in DB (no insert on replay)')
        ok = ok && true
      } else {
        if (!dupOk)   fail('duplicate not suppressed', `created=${replay.created} reason=${!replay.created ? replay.reason : 'n/a'}`)
        if (!idOk)    fail('existingTaskId mismatch')
        if (!countOk) fail('wrong task count in DB', `got=${taskCount.length} expected=1`)
        ok = false
      }
    } catch (err) {
      fail('callback_request: unexpected error', String(err))
    }
    record(ok)
    // Keep lead + task alive for test 6 (resolve test)
  }

  // ── Test 2: question → normal-priority task + recommended reply ─────────────
  head('2. "is it still available?" → normal-priority question task + recommended reply')
  {
    let ok = false
    let leadId: string | undefined
    try {
      const lead = await seedLead(tenantId, 'question', '2023 Honda Civic')
      leadId = lead.id

      const result = await createHandoffTask({
        tenantId,
        leadId: lead.id,
        classification: 'question',
        customerMessage: 'is it still available?',
      })

      if (!result.created) { fail('task not created', `reason=${result.reason}`); record(false); return }

      const task = result.task
      const priorityOk = task.priority === 'normal'
      const typeOk     = task.taskType === 'sales'
      const replyOk    = !!task.recommendedReply &&
                         task.recommendedReply.includes(lead.firstName) &&
                         task.recommendedReply.includes('2023 Honda Civic')
      const actionOk   = task.recommendedNextAction.includes("customer's question")

      if (priorityOk && typeOk && replyOk && actionOk) {
        pass('priority=normal')
        pass('taskType=sales')
        pass('recommendedReply contains firstName + vehicle', `"${task.recommendedReply}"`)
        pass('recommendedNextAction correct')
        ok = true
      } else {
        if (!priorityOk) fail('priority wrong', `got=${task.priority}`)
        if (!typeOk)     fail('taskType wrong', `got=${task.taskType}`)
        if (!replyOk)    fail('recommendedReply wrong', `got="${task.recommendedReply}"`)
        if (!actionOk)   fail('recommendedNextAction wrong', `got="${task.recommendedNextAction}"`)
      }
    } catch (err) {
      fail('question: unexpected error', String(err))
    } finally {
      if (leadId) await deleteLead(leadId)
    }
    record(ok)
  }

  // ── Test 3: appointment_request → urgent sales task ────────────────────────
  head('3. "want to test drive it" → urgent appointment_request task')
  {
    let ok = false
    let leadId: string | undefined
    try {
      const lead = await seedLead(tenantId, 'appt')
      leadId = lead.id

      const result = await createHandoffTask({
        tenantId,
        leadId: lead.id,
        classification: 'appointment_request',
        customerMessage: 'I want to come test drive it this weekend',
      })

      if (!result.created) { fail('task not created', `reason=${result.reason}`); record(false); return }

      const task = result.task
      const priorityOk = task.priority === 'urgent'
      const typeOk     = task.taskType === 'sales'
      const actionOk   = task.recommendedNextAction.includes('appointment')
      const replyOk    = !!task.recommendedReply && task.recommendedReply.includes('come in')

      if (priorityOk && typeOk && actionOk && replyOk) {
        pass('priority=urgent')
        pass('taskType=sales')
        pass('recommendedNextAction mentions appointment')
        pass('recommendedReply is human-ready', `"${task.recommendedReply}"`)
        ok = true
      } else {
        if (!priorityOk) fail('priority wrong', `got=${task.priority}`)
        if (!typeOk)     fail('taskType wrong', `got=${task.taskType}`)
        if (!actionOk)   fail('recommendedNextAction wrong', `got="${task.recommendedNextAction}"`)
        if (!replyOk)    fail('recommendedReply wrong', `got="${task.recommendedReply}"`)
      }
    } catch (err) {
      fail('appointment_request: unexpected error', String(err))
    } finally {
      if (leadId) await deleteLead(leadId)
    }
    record(ok)
  }

  // ── Test 4: angry_or_complaint → urgent escalation task, no reply ──────────
  head('4. "I\'m pissed, stop texting me" → urgent escalation task, no recommended reply')
  {
    let ok = false
    let leadId: string | undefined
    try {
      const lead = await seedLead(tenantId, 'angry')
      leadId = lead.id

      const result = await createHandoffTask({
        tenantId,
        leadId: lead.id,
        classification: 'angry_or_complaint',
        customerMessage: "I'm pissed, stop texting me",
      })

      if (!result.created) { fail('task not created', `reason=${result.reason}`); record(false); return }

      const task = result.task
      const priorityOk = task.priority === 'urgent'
      const typeOk     = task.taskType === 'escalation'   // NOT 'sales'
      const noReplyOk  = task.recommendedReply === null
      const actionOk   = task.recommendedNextAction.includes('Escalate')
      const statusOk   = task.status === 'open'

      if (priorityOk && typeOk && noReplyOk && actionOk && statusOk) {
        pass('priority=urgent')
        pass('taskType=escalation  (not a sales opportunity)')
        pass('recommendedReply=null  (do not suggest engaging with angry customer)')
        pass('recommendedNextAction: escalate to manager')
        pass('status=open')
        ok = true
      } else {
        if (!priorityOk) fail('priority wrong', `got=${task.priority}`)
        if (!typeOk)     fail('taskType wrong', `got=${task.taskType}  (expected escalation)`)
        if (!noReplyOk)  fail('recommendedReply should be null', `got="${task.recommendedReply}"`)
        if (!actionOk)   fail('recommendedNextAction wrong', `got="${task.recommendedNextAction}"`)
        if (!statusOk)   fail('status wrong', `got=${task.status}`)
      }
    } catch (err) {
      fail('angry_or_complaint: unexpected error', String(err))
    } finally {
      if (leadId) await deleteLead(leadId)
    }
    record(ok)
  }

  // ── Test 5: non-handoff classification → no task created ───────────────────
  head('5. not_interested classification → no task created (terminal, not a handoff)')
  {
    let ok = false
    let leadId: string | undefined
    try {
      const lead = await seedLead(tenantId, 'not_interested')
      leadId = lead.id

      const result = await createHandoffTask({
        tenantId,
        leadId: lead.id,
        classification: 'not_interested',
        customerMessage: 'not interested',
      })

      const noTaskOk = !result.created && result.reason === 'classification_not_handoff'

      if (noTaskOk) {
        pass('not_interested: no task created  (reason=classification_not_handoff)')
        ok = true
      } else {
        fail('not_interested: expected classification_not_handoff', `created=${result.created}`)
      }
    } catch (err) {
      fail('not_interested: unexpected error', String(err))
    } finally {
      if (leadId) await deleteLead(leadId)
    }
    record(ok)
  }

  // ── Test 6: human resolves task → status=resolved + lastHumanContactAt ──────
  head('6. Human resolves task → status=resolved + lead.lastHumanContactAt stamped')
  {
    let ok = false
    try {
      if (!test1TaskId || !test1LeadId) {
        fail('prerequisite: test 1 must have created a task')
        record(false)
        return
      }

      const before = new Date()

      await resolveHandoffTask({ taskId: test1TaskId })

      // Verify task status
      const task = await db.query.handoffTasks.findFirst({
        where: eq(handoffTasks.id, test1TaskId),
      })

      // Verify lead.lastHumanContactAt
      const lead = await db.query.leads.findFirst({
        where: eq(leads.id, test1LeadId),
      })

      const resolvedOk    = task?.status === 'resolved'
      const resolvedAtOk  = !!task?.resolvedAt && task.resolvedAt >= before
      const humanStampOk  = !!lead?.lastHumanContactAt && lead.lastHumanContactAt >= before

      if (resolvedOk && resolvedAtOk && humanStampOk) {
        pass('task.status=resolved')
        pass('task.resolvedAt set', `value=${task!.resolvedAt!.toISOString()}`)
        pass('lead.lastHumanContactAt stamped', `value=${lead!.lastHumanContactAt!.toISOString()}`)
        ok = true
      } else {
        if (!resolvedOk)   fail('task.status wrong', `got=${task?.status}`)
        if (!resolvedAtOk) fail('task.resolvedAt not set or before resolve call',
          `got=${task?.resolvedAt?.toISOString()}`)
        if (!humanStampOk) fail('lead.lastHumanContactAt not stamped',
          `got=${lead?.lastHumanContactAt?.toISOString()}`)
      }

      // Verify resolve is idempotent (second call is a no-op)
      await resolveHandoffTask({ taskId: test1TaskId })
      const taskAfterSecondResolve = await db.query.handoffTasks.findFirst({
        where: eq(handoffTasks.id, test1TaskId),
      })
      if (taskAfterSecondResolve?.status === 'resolved') {
        pass('resolve is idempotent  (second call is a no-op)')
      } else {
        fail('resolve not idempotent', `status=${taskAfterSecondResolve?.status}`)
        ok = false
      }
    } catch (err) {
      fail('resolve: unexpected error', String(err))
    } finally {
      // Clean up test 1 lead (kept alive until now for this test)
      if (test1LeadId) await deleteLead(test1LeadId)
    }
    record(ok)
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  head('SUMMARY')
  const color = failed === 0 ? '\x1b[32m' : '\x1b[31m'
  log(`  ${color}${BOLD}${passed} passed  |  ${failed} failed${RESET}`)
  sep()
  log('')

  const outPath = '/tmp/dlr-handoff-agent-verify.txt'
  const { writeFileSync } = await import('fs')
  writeFileSync(outPath, lines.join('\n') + '\n')
  console.log(`${DIM}Full output saved to ${outPath}${RESET}\n`)

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('\nVerification crashed:', err)
  process.exit(1)
})
