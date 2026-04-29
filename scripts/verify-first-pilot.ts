/**
 * Phase 11 — First Live Pilot Verification
 *
 * 11 tests covering:
 *  1.  Cannot create first pilot batch with more than 5 leads
 *  2.  Cannot start smoke test unless batch is approved + isFirstPilot
 *  3.  Smoke test enrolls exactly one lead
 *  4.  Cannot send remaining leads before smoke test passes
 *  5.  verifySmokeTest fails (and pauses batch) when no audit row exists
 *  6.  verifySmokeTest passes when audit row exists
 *  7.  startRemainingLeads enrolls all remaining approved leads
 *  8.  continuationRequired blocks startRemainingLeads
 *  9.  confirmContinuation clears continuationRequired
 * 10.  Pause/cancel state blocks startRemainingLeads
 * 11.  getFirstPilotStatus returns correct nextAction for each state
 */

import 'dotenv/config'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import * as schema from '../src/lib/db/schema'
import {
  validateFirstPilotReadiness,
  startSmokeTest,
  verifySmokeTest,
  startRemainingLeads,
  confirmContinuation,
  getFirstPilotStatus,
} from '../src/lib/pilot/first-pilot'

const {
  tenants, leads, workflows, workflowSteps,
  workflowEnrollments, workflowStepExecutions, messages, conversations,
  pilotBatches, pilotBatchLeads,
} = schema

// ── Test harness ─────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const log: string[] = []

function assert(condition: boolean, name: string, detail = '') {
  if (condition) {
    passed++
    log.push(`  ✓ ${name}`)
  } else {
    failed++
    log.push(`  ✗ ${name}${detail ? ': ' + detail : ''}`)
  }
}

// ── DB ────────────────────────────────────────────────────────────────────────

const sql = postgres(process.env.DATABASE_URL!)
const db  = drizzle(sql, { schema })

// ── Seed helpers ──────────────────────────────────────────────────────────────

async function createTenant(overrides: Partial<typeof tenants.$inferInsert> = {}) {
  const [t] = await db.insert(tenants).values({
    name: `Phase11-Test-${Date.now()}`,
    slug: `phase11-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    tenDlcStatus: 'dev_override',
    smsLiveApproved: true,
    smsSendingNumber: '+15550001234',
    brandStatus: 'approved',
    campaignStatus: 'approved',
    messagingProfileId: 'mp-test',
    campaignId: 'CMP-test',
    ...overrides,
  }).returning()
  return t
}

async function createLead(
  tenantId: string,
  overrides: Partial<typeof leads.$inferInsert> = {}
) {
  const [l] = await db.insert(leads).values({
    tenantId,
    firstName: 'Test',
    lastName: 'Lead',
    phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
    state: 'active',
    consentStatus: 'explicit',
    ...overrides,
  }).returning()
  return l
}

async function createWorkflow(
  tenantId: string,
  overrides: Partial<typeof workflows.$inferInsert> = {}
) {
  const [wf] = await db.insert(workflows).values({
    tenantId,
    name: `Test WF ${Date.now()}`,
    triggerType: 'manual',
    isActive: true,
    approvedForLive: true,
    requiresOptOutLanguage: false,
    activationStatus: 'active',
    ...overrides,
  }).returning()
  return wf
}

async function createStep(workflowId: string, position = 1) {
  const config: schema.SendSmsConfig = {
    type: 'send_sms',
    template: 'Hi {{firstName}}, test message.',
    delayHours: 0,
  }
  const [s] = await db.insert(workflowSteps).values({
    workflowId,
    position,
    type: 'send_sms',
    config,
  }).returning()
  return s
}

async function createBatch(
  tenantId: string,
  workflowId: string,
  overrides: Partial<typeof pilotBatches.$inferInsert> = {}
) {
  const [b] = await db.insert(pilotBatches).values({
    tenantId,
    workflowId,
    createdBy: 'test-admin',
    status: 'approved',
    isFirstPilot: true,
    firstPilotState: 'not_started',
    dryRunSummary: { generatedAt: new Date().toISOString(), eligibleCount: 0, ineligibleCount: 0, leads: [] },
    ...overrides,
  }).returning()
  return b
}

async function addLeadToBatch(
  batchId: string,
  leadId: string,
  overrides: Partial<typeof pilotBatchLeads.$inferInsert> = {}
) {
  const [bl] = await db.insert(pilotBatchLeads).values({
    batchId,
    leadId,
    approvedForSend: true,
    sendStatus: 'pending',
    ...overrides,
  }).returning()
  return bl
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

const tenantIds: string[] = []

async function cleanup() {
  for (const id of tenantIds) {
    await db.delete(tenants).where(eq(tenants.id, id))
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/**
 * 1. Cannot start smoke test when batch has > 5 leads (FIRST_PILOT_CAP enforcement)
 */
async function test1_capEnforced() {
  console.log('\n1. FIRST_PILOT_CAP (5) enforced — smoke test blocked if batch has > 5 leads')
  const t  = await createTenant()
  tenantIds.push(t.id)
  const wf = await createWorkflow(t.id)
  await createStep(wf.id)
  const batch = await createBatch(t.id, wf.id)

  // Add 6 leads — one over the cap
  for (let i = 0; i < 6; i++) {
    const lead = await createLead(t.id)
    await addLeadToBatch(batch.id, lead.id)
  }

  const result = await startSmokeTest(batch.id)
  assert(!result.success, 'startSmokeTest fails when batch has 6 leads')
  assert(
    result.error?.includes('cap') || result.error?.includes('5') || false,
    'Error mentions cap',
    result.error ?? ''
  )
}

/**
 * 2. Cannot start smoke test unless batch is approved + isFirstPilot
 */
async function test2_stateGates() {
  console.log('\n2. State gates — smoke test requires approved status and isFirstPilot=true')
  const t  = await createTenant()
  tenantIds.push(t.id)
  const wf = await createWorkflow(t.id)
  await createStep(wf.id)

  // Non-first-pilot batch
  const batchA = await createBatch(t.id, wf.id, { isFirstPilot: false })
  const lead   = await createLead(t.id)
  await addLeadToBatch(batchA.id, lead.id)

  // startSmokeTest won't block on isFirstPilot directly, but validateReadiness will
  const { ready: readyA } = await validateFirstPilotReadiness(batchA.id)
  assert(!readyA, 'validateReadiness fails when isFirstPilot = false')

  // Batch not in approved state
  const batchB = await createBatch(t.id, wf.id, { status: 'draft' })
  const lead2  = await createLead(t.id)
  await addLeadToBatch(batchB.id, lead2.id)
  const res = await startSmokeTest(batchB.id)
  assert(!res.success, 'startSmokeTest fails when batch status is draft')
}

/**
 * 3. Smoke test enrolls exactly one lead
 */
async function test3_smokeTestEnrollsOne() {
  console.log('\n3. Smoke test enrolls exactly one lead')
  const t  = await createTenant()
  tenantIds.push(t.id)
  const wf = await createWorkflow(t.id)
  await createStep(wf.id)
  const batch = await createBatch(t.id, wf.id)

  // Add 3 leads
  for (let i = 0; i < 3; i++) {
    const lead = await createLead(t.id)
    await addLeadToBatch(batch.id, lead.id)
  }

  const result = await startSmokeTest(batch.id)
  assert(result.success, 'startSmokeTest succeeds', result.error)
  assert(!!result.smokeTestLeadId, 'smokeTestLeadId is returned')

  // Check that exactly 1 lead is now in 'sent' status
  const updatedLeads = await db.query.pilotBatchLeads.findMany({
    where: eq(pilotBatchLeads.batchId, batch.id),
  })
  const sentLeads    = updatedLeads.filter(l => l.sendStatus === 'sent')
  const pendingLeads = updatedLeads.filter(l => l.sendStatus === 'pending')
  assert(sentLeads.length === 1, 'Exactly one lead is marked sent')
  assert(pendingLeads.length === 2, 'Remaining two leads are still pending')

  // Check batch state transitioned to smoke_test_sending
  const updatedBatch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, batch.id),
  })
  assert(updatedBatch?.firstPilotState === 'smoke_test_sending', 'Batch state is smoke_test_sending')
  assert(updatedBatch?.smokeTestSentAt !== null, 'smokeTestSentAt is set')
}

/**
 * 4. Cannot send remaining leads before smoke test passes
 */
async function test4_remainingBlockedBeforeSmokePass() {
  console.log('\n4. Remaining sends blocked before smoke test passes')
  const t  = await createTenant()
  tenantIds.push(t.id)
  const wf = await createWorkflow(t.id)
  await createStep(wf.id)

  // Batch in smoke_test_sending state
  const batch = await createBatch(t.id, wf.id, {
    firstPilotState: 'smoke_test_sending',
    status: 'sending',
  })
  const lead = await createLead(t.id)
  await addLeadToBatch(batch.id, lead.id)

  const result = await startRemainingLeads(batch.id)
  assert(!result.success, 'startRemainingLeads fails when state is smoke_test_sending')
  assert(
    result.error?.includes('smoke test') || result.error?.includes('state') || false,
    'Error mentions smoke test requirement',
    result.error ?? ''
  )

  // Also blocked from not_started
  const batch2 = await createBatch(t.id, wf.id, { firstPilotState: 'not_started' })
  const lead2  = await createLead(t.id)
  await addLeadToBatch(batch2.id, lead2.id)
  const result2 = await startRemainingLeads(batch2.id)
  assert(!result2.success, 'startRemainingLeads fails when state is not_started')
}

/**
 * 5. verifySmokeTest fails and pauses batch when no message audit row exists
 */
async function test5_smokeTestFailsNoAuditRow() {
  console.log('\n5. verifySmokeTest fails + pauses batch when no message audit row')
  const t  = await createTenant()
  tenantIds.push(t.id)
  const wf = await createWorkflow(t.id)
  await createStep(wf.id)

  // Create an enrollment (but no message row)
  const lead = await createLead(t.id)
  const [enrollment] = await db.insert(workflowEnrollments).values({
    leadId: lead.id,
    workflowId: wf.id,
    status: 'active',
    currentStepPosition: 1,
  }).returning()

  const batch = await createBatch(t.id, wf.id, {
    firstPilotState: 'smoke_test_sending',
    status: 'sending',
  })
  const batchLead = await addLeadToBatch(batch.id, lead.id, {
    sendStatus: 'sent',
    enrollmentId: enrollment.id,
  })

  // Set smokeTestLeadId
  await db.update(pilotBatches)
    .set({ smokeTestLeadId: batchLead.id })
    .where(eq(pilotBatches.id, batch.id))

  // Create a step execution but NO messages row
  const step = await db.query.workflowSteps.findFirst({
    where: eq(workflowSteps.workflowId, wf.id),
  })
  await db.insert(workflowStepExecutions).values({
    enrollmentId: enrollment.id,
    stepId: step!.id,
    status: 'executed',
    scheduledAt: new Date(),
    executedAt: new Date(),
  })

  const result = await verifySmokeTest(batch.id)
  assert(!result.passed, 'verifySmokeTest fails when no message row')
  assert(result.state === 'smoke_test_failed', 'State is smoke_test_failed')

  const updatedBatch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, batch.id),
  })
  assert(updatedBatch?.status === 'paused', 'Batch is paused after smoke test failure')
  assert(updatedBatch?.smokeTestFailedAt !== null, 'smokeTestFailedAt is set')
}

/**
 * 6. verifySmokeTest passes when message audit row exists
 */
async function test6_smokeTestPassesWithAuditRow() {
  console.log('\n6. verifySmokeTest passes when message audit row exists')
  const t  = await createTenant()
  tenantIds.push(t.id)
  const wf = await createWorkflow(t.id)
  await createStep(wf.id)

  const lead = await createLead(t.id)
  const [enrollment] = await db.insert(workflowEnrollments).values({
    leadId: lead.id,
    workflowId: wf.id,
    status: 'active',
    currentStepPosition: 1,
  }).returning()

  const batch = await createBatch(t.id, wf.id, {
    firstPilotState: 'smoke_test_sending',
    status: 'sending',
  })
  const batchLead = await addLeadToBatch(batch.id, lead.id, {
    sendStatus: 'sent',
    enrollmentId: enrollment.id,
  })
  await db.update(pilotBatches)
    .set({ smokeTestLeadId: batchLead.id })
    .where(eq(pilotBatches.id, batch.id))

  // Create step execution AND a messages row (messages requires a conversation)
  const step = await db.query.workflowSteps.findFirst({
    where: eq(workflowSteps.workflowId, wf.id),
  })
  const [exec] = await db.insert(workflowStepExecutions).values({
    enrollmentId: enrollment.id,
    stepId: step!.id,
    status: 'executed',
    scheduledAt: new Date(),
    executedAt: new Date(),
  }).returning()

  const [conv] = await db.insert(conversations).values({
    tenantId: t.id,
    leadId: lead.id,
    tenantPhone: '+15550001234',
    leadPhone: lead.phone,
    status: 'open',
  }).returning()

  await db.insert(messages).values({
    conversationId: conv.id,
    stepExecutionId: exec.id,
    direction: 'outbound',
    body: 'Hi Test, test message.',
    status: 'delivered',
    providerMessageId: 'telnyx-msg-abc123',
    sentAt: new Date(),
  })

  const result = await verifySmokeTest(batch.id)
  assert(result.passed, 'verifySmokeTest passes when message row exists')
  assert(result.auditRowFound, 'auditRowFound is true')
  assert(result.providerIdFound, 'providerIdFound is true')
  assert(result.state === 'smoke_test_passed', 'State is smoke_test_passed')

  const updatedBatch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, batch.id),
  })
  assert(updatedBatch?.firstPilotState === 'smoke_test_passed', 'Batch firstPilotState is smoke_test_passed')
  assert(updatedBatch?.auditRowVerified === true, 'auditRowVerified = true on batch')
}

/**
 * 7. startRemainingLeads enrolls all remaining approved leads (not the smoke lead)
 */
async function test7_remainingEnrollsAll() {
  console.log('\n7. startRemainingLeads enrolls all remaining leads')
  const t  = await createTenant()
  tenantIds.push(t.id)
  const wf = await createWorkflow(t.id)
  await createStep(wf.id)

  const batch = await createBatch(t.id, wf.id, {
    firstPilotState: 'smoke_test_passed',
    status: 'sending',
  })

  // Smoke lead (already sent)
  const smokeLead     = await createLead(t.id)
  const [enrollment]  = await db.insert(workflowEnrollments).values({
    leadId: smokeLead.id, workflowId: wf.id, status: 'active', currentStepPosition: 1,
  }).returning()
  const smokeBatchLead = await addLeadToBatch(batch.id, smokeLead.id, {
    sendStatus: 'sent',
    enrollmentId: enrollment.id,
  })

  // Set smoke lead on batch
  await db.update(pilotBatches)
    .set({ smokeTestLeadId: smokeBatchLead.id })
    .where(eq(pilotBatches.id, batch.id))

  // Two remaining leads
  const lead2 = await createLead(t.id)
  const lead3 = await createLead(t.id)
  await addLeadToBatch(batch.id, lead2.id)
  await addLeadToBatch(batch.id, lead3.id)

  const result = await startRemainingLeads(batch.id)
  assert(result.success, 'startRemainingLeads succeeds', result.error)
  assert(result.enrolledCount === 2, `Enrolled exactly 2 remaining leads (got ${result.enrolledCount})`)

  const updatedBatch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, batch.id),
  })
  assert(updatedBatch?.firstPilotState === 'remaining_sending', 'State transitions to remaining_sending')
}

/**
 * 8. continuationRequired blocks startRemainingLeads
 */
async function test8_continuationRequiredBlocks() {
  console.log('\n8. continuationRequired flag blocks startRemainingLeads')
  const t  = await createTenant()
  tenantIds.push(t.id)
  const wf = await createWorkflow(t.id)
  await createStep(wf.id)

  const batch = await createBatch(t.id, wf.id, {
    firstPilotState: 'smoke_test_passed',
    status: 'sending',
    continuationRequired: true,
    continuationReason: 'STOP received from test lead',
  })
  const lead = await createLead(t.id)
  await addLeadToBatch(batch.id, lead.id)

  const result = await startRemainingLeads(batch.id)
  assert(!result.success, 'startRemainingLeads blocked when continuationRequired = true')
  assert(
    result.error?.includes('confirmation') || result.error?.includes('STOP') || result.error?.includes('complaint') || false,
    'Error mentions manual confirmation',
    result.error ?? ''
  )
}

/**
 * 9. confirmContinuation clears the continuationRequired flag
 */
async function test9_confirmContinuation() {
  console.log('\n9. confirmContinuation clears the continuationRequired flag')
  const t  = await createTenant()
  tenantIds.push(t.id)
  const wf = await createWorkflow(t.id)
  await createStep(wf.id)

  const batch = await createBatch(t.id, wf.id, {
    firstPilotState: 'smoke_test_passed',
    status: 'sending',
    continuationRequired: true,
    continuationReason: 'Test complaint',
  })

  // Confirm continuation
  const result = await confirmContinuation(batch.id, 'admin@test.com')
  assert(result.success, 'confirmContinuation succeeds')

  const updatedBatch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, batch.id),
  })
  assert(updatedBatch?.continuationRequired === false, 'continuationRequired is cleared')
  assert(updatedBatch?.continuationConfirmedBy === 'admin@test.com', 'continuationConfirmedBy is set')
  assert(updatedBatch?.continuationConfirmedAt !== null, 'continuationConfirmedAt is set')
}

/**
 * 10. Paused or cancelled batch blocks startRemainingLeads
 */
async function test10_pausedCancelledBlocks() {
  console.log('\n10. Paused/cancelled batch blocks startRemainingLeads')
  const t  = await createTenant()
  tenantIds.push(t.id)
  const wf = await createWorkflow(t.id)
  await createStep(wf.id)

  // Paused
  const paused = await createBatch(t.id, wf.id, {
    firstPilotState: 'smoke_test_passed',
    status: 'paused',
  })
  const lead1 = await createLead(t.id)
  await addLeadToBatch(paused.id, lead1.id)
  const r1 = await startRemainingLeads(paused.id)
  assert(!r1.success, 'startRemainingLeads fails when batch is paused')
  assert(r1.error?.includes('paused') ?? false, 'Error mentions paused state', r1.error ?? '')

  // Cancelled
  const cancelled = await createBatch(t.id, wf.id, {
    firstPilotState: 'smoke_test_passed',
    status: 'cancelled',
  })
  const lead2 = await createLead(t.id)
  await addLeadToBatch(cancelled.id, lead2.id)
  const r2 = await startRemainingLeads(cancelled.id)
  assert(!r2.success, 'startRemainingLeads fails when batch is cancelled')
  assert(r2.error?.includes('cancelled') ?? false, 'Error mentions cancelled state', r2.error ?? '')
}

/**
 * 11. getFirstPilotStatus returns correct nextAction for key states
 */
async function test11_nextActionPerState() {
  console.log('\n11. getFirstPilotStatus returns correct nextAction per state')
  const t  = await createTenant()
  tenantIds.push(t.id)
  const wf = await createWorkflow(t.id)
  await createStep(wf.id)

  const stateExpected: Array<{ state: schema.FirstPilotState; keyword: string }> = [
    { state: 'not_started',         keyword: 'Smoke Test' },
    { state: 'ready_for_smoke_test', keyword: 'Smoke Test' },
    { state: 'smoke_test_sending',   keyword: 'Verify' },
    { state: 'smoke_test_passed',    keyword: 'remaining' },
    { state: 'smoke_test_failed',    keyword: 'Investigate' },
    { state: 'ready_for_remaining',  keyword: 'Remaining' },
    { state: 'remaining_sending',    keyword: 'Monitor' },
    { state: 'completed',            keyword: 'complete' },
    { state: 'paused',               keyword: 'paused' },
    { state: 'cancelled',            keyword: 'cancelled' },
  ]

  for (const { state, keyword } of stateExpected) {
    const batch = await createBatch(t.id, wf.id, { firstPilotState: state })
    const lead  = await createLead(t.id)
    await addLeadToBatch(batch.id, lead.id)

    const status = await getFirstPilotStatus(batch.id)
    assert(
      status?.nextAction?.toLowerCase().includes(keyword.toLowerCase()) ?? false,
      `nextAction for '${state}' contains '${keyword}'`,
      `got: "${status?.nextAction ?? 'null'}"`
    )
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('══════════════════════════════════════════════')
  console.log(' Phase 11 — First Live Pilot Verification')
  console.log('══════════════════════════════════════════════')

  try {
    await test1_capEnforced()
    await test2_stateGates()
    await test3_smokeTestEnrollsOne()
    await test4_remainingBlockedBeforeSmokePass()
    await test5_smokeTestFailsNoAuditRow()
    await test6_smokeTestPassesWithAuditRow()
    await test7_remainingEnrollsAll()
    await test8_continuationRequiredBlocks()
    await test9_confirmContinuation()
    await test10_pausedCancelledBlocks()
    await test11_nextActionPerState()
  } finally {
    await cleanup()
    await sql.end()
  }

  console.log('\n──────────────────────────────────────────────')
  log.forEach(l => console.log(l))
  console.log('──────────────────────────────────────────────')
  console.log(`\n  ${passed} passed | ${failed} failed\n`)

  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
