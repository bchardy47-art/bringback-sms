/**
 * Admin Visibility Verification Script  (Phase 6)
 *
 * Seeds controlled sample data and proves every admin query returns the
 * correct records. Tests call the query layer directly (no HTTP overhead).
 *
 * Verification requirements:
 *   1. Open handoff appears in handoff queue
 *   2. Resolved handoff disappears from open queue / appears in resolved view
 *   3. Lead detail explains suppression reason
 *   4. Lead detail shows latest skip reason from message audit
 *   5. Automation health shows SMS_LIVE_MODE=false when live mode is off
 *   6. Tenant pause blocks automation and appears in health
 *   7. Suppression report groups leads by reason
 *   8. Message audit shows skipped/blocked sends with skip_reason
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/verify-admin-visibility.ts
 */

import { config } from 'dotenv'
config({ path: new URL('../.env.local', import.meta.url).pathname })

import { and, eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import {
  conversations, handoffTasks, leads, messages, optOuts, tenants,
  workflowEnrollments, workflowStepExecutions, workflows,
} from '../src/lib/db/schema'
import {
  getHandoffQueue,
  getLeadDetail,
  getAutomationHealth,
  getMessageAuditLog,
  getSuppressionReport,
  pauseTenantAutomation,
  resumeTenantAutomation,
} from '../src/lib/admin/dlr-queries'
import { createHandoffTask, resolveHandoffTask } from '../src/lib/handoff/handoff-agent'

// ── Colours ───────────────────────────────────────────────────────────────────
const GREEN = '\x1b[32m✓\x1b[0m'
const RED   = '\x1b[31m✗\x1b[0m'
const DIM   = '\x1b[2m'
const RESET = '\x1b[0m'
const BOLD  = '\x1b[1m'

const lines: string[] = []
function log(line: string) { console.log(line); lines.push(line.replace(/\x1b\[[0-9;]*m/g, '')) }
function pass(label: string, detail?: string) {
  log(`  ${GREEN} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`)
}
function fail(label: string, detail?: string) {
  log(`  ${RED} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`)
}
function sep()  { log('────────────────────────────────────────────────────') }
function head(t: string) { log(''); sep(); log(`  ${BOLD}${t}${RESET}`); sep() }

let passed = 0
let failed = 0
function record(ok: boolean) { ok ? passed++ : failed++ }

// ── Seed helpers ──────────────────────────────────────────────────────────────
let phoneCounter = 6000
function freshPhone() { return `+1555077${String(phoneCounter++).padStart(4, '0')}` }

const cleanupLeadIds: string[] = []

async function seedLead(tenantId: string, tag: string, overrides: Record<string, unknown> = {}) {
  const [lead] = await db.insert(leads).values({
    tenantId,
    firstName: 'Admin',
    lastName: `Verify-${tag}`,
    phone: freshPhone(),
    state: 'responded',
    vehicleOfInterest: '2024 Kia EV6',
    isTest: false,
    doNotAutomate: false,
    crmSource: 'csv',
    ...overrides,
  }).returning()
  cleanupLeadIds.push(lead.id)
  return lead
}

async function seedConversation(tenantId: string, leadId: string, tenantPhone: string, leadPhone: string) {
  const [conv] = await db.insert(conversations).values({
    tenantId, leadId, tenantPhone, leadPhone, status: 'open',
  }).onConflictDoUpdate({
    target: conversations.leadId,
    set: { updatedAt: new Date() },
  }).returning()
  return conv
}

async function seedSkippedMessage(convId: string, skipReason: string) {
  await db.insert(messages).values({
    conversationId: convId,
    direction: 'outbound',
    body: `[skipped — ${skipReason}]`,
    status: 'queued',
    provider: 'telnyx',
    skipReason,
    skippedAt: new Date(),
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // ── Resolve context ──────────────────────────────────────────────────────────
  const tenantId = process.env.VERIFY_TENANT_ID
    ?? (await db.query.tenants.findFirst().then(t => t?.id))
  if (!tenantId) { console.error('No tenant found.'); process.exit(1) }

  const { phoneNumbers } = await import('../src/lib/db/schema')
  const ph = await db.query.phoneNumbers.findFirst({ where: eq(phoneNumbers.tenantId, tenantId) })
  const tenantPhoneNum = ph?.number ?? '+18015155345'

  head('ADMIN VISIBILITY VERIFICATION')
  log(`  Tenant: ${tenantId}`)
  sep()
  log('')

  // ══════════════════════════════════════════════════════════════════════════
  // 1. Open handoff appears in handoff queue
  // ══════════════════════════════════════════════════════════════════════════
  head('1. Open handoff appears in handoff queue')
  let handoffTaskId: string | undefined
  let handoffLeadId: string | undefined
  {
    let ok = false
    try {
      const lead = await seedLead(tenantId, 'handoff-queue')
      handoffLeadId = lead.id

      const result = await createHandoffTask({
        tenantId, leadId: lead.id,
        classification: 'appointment_request',
        customerMessage: 'I want to come test drive this weekend',
      })
      if (!result.created) throw new Error(`Task not created: ${result.reason}`)
      handoffTaskId = result.task.id

      const queue = await getHandoffQueue(tenantId, { status: 'open' })
      const found = queue.find(t => t.id === handoffTaskId)

      if (found) {
        pass('open handoff task found in queue', `id=${handoffTaskId.slice(0, 8)}… priority=${found.priority}`)
        pass('lead data included', `name=${found.lead.firstName} ${found.lead.lastName}`)
        ok = true
      } else {
        fail('task not found in open queue')
      }
    } catch (err) {
      fail('unexpected error', String(err))
    }
    record(ok)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. Resolved handoff disappears from open queue, appears in resolved view
  // ══════════════════════════════════════════════════════════════════════════
  head('2. Resolved handoff moves from open → resolved view')
  {
    let ok = false
    try {
      if (!handoffTaskId) throw new Error('Prerequisite: test 1 must have created a task')

      await resolveHandoffTask({ taskId: handoffTaskId })

      const openQueue     = await getHandoffQueue(tenantId, { status: 'open' })
      const resolvedQueue = await getHandoffQueue(tenantId, { status: 'resolved' })

      const inOpen     = openQueue.find(t => t.id === handoffTaskId)
      const inResolved = resolvedQueue.find(t => t.id === handoffTaskId)

      if (!inOpen && inResolved) {
        pass('task absent from open queue after resolve')
        pass('task present in resolved view', `status=${inResolved.status}`)
        ok = true
      } else {
        if (inOpen)     fail('task still appears in open queue')
        if (!inResolved) fail('task not found in resolved view')
      }
    } catch (err) {
      fail('unexpected error', String(err))
    }
    record(ok)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. Lead detail explains suppression reason
  // ══════════════════════════════════════════════════════════════════════════
  head('3. Lead detail shows suppression reason')
  {
    let ok = false
    try {
      const lead = await seedLead(tenantId, 'suppressed', {
        suppressionReason: 'cooldown_active',
        state: 'stale',
      })

      const detail = await getLeadDetail(tenantId, lead.id)

      if (detail?.suppressionReason === 'cooldown_active') {
        pass('suppressionReason visible in lead detail', `reason=cooldown_active`)
        ok = true
      } else {
        fail('suppressionReason wrong', `got=${detail?.suppressionReason}`)
      }
    } catch (err) {
      fail('unexpected error', String(err))
    }
    record(ok)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Lead detail shows latest skip reason from message audit
  // ══════════════════════════════════════════════════════════════════════════
  head('4. Lead detail shows skip reason from message audit')
  {
    let ok = false
    try {
      const lead = await seedLead(tenantId, 'skip-reason')
      const conv = await seedConversation(tenantId, lead.id, tenantPhoneNum, lead.phone)
      await seedSkippedMessage(conv.id, 'lead_replied')

      const detail = await getLeadDetail(tenantId, lead.id)
      const skippedMsg = detail?.recentMessages.find(m => m.skipReason === 'lead_replied')

      if (skippedMsg) {
        pass('skipped message visible in lead detail', `skipReason=${skippedMsg.skipReason}`)
        ok = true
      } else {
        fail('no skipped message found in lead detail')
      }
    } catch (err) {
      fail('unexpected error', String(err))
    }
    record(ok)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. Automation health shows SMS_LIVE_MODE=false when live mode is off
  // ══════════════════════════════════════════════════════════════════════════
  head('5. Automation health shows SMS_LIVE_MODE status')
  {
    let ok = false
    try {
      const health = await getAutomationHealth(tenantId)
      if (!health) throw new Error('Health returned null')

      // In test environment SMS_LIVE_MODE should not be set
      const liveModeOff = health.smsLiveMode === false
      const hasEnrollmentCounts = typeof health.activeEnrollments === 'number'
      const hasHandoffCounts    = typeof health.openHandoffTasks === 'number'
      const has24hStats         = typeof health.messagesLast24h.sent === 'number'

      if (liveModeOff && hasEnrollmentCounts && hasHandoffCounts && has24hStats) {
        pass('smsLiveMode=false  (SMS_LIVE_MODE not set in env)', `value=${health.smsLiveMode}`)
        pass('activeEnrollments reported', `count=${health.activeEnrollments}`)
        pass('openHandoffTasks reported', `count=${health.openHandoffTasks}`)
        pass('messagesLast24h reported', `sent=${health.messagesLast24h.sent} skipped=${health.messagesLast24h.skipped}`)
        ok = true
      } else {
        if (!liveModeOff)          fail('smsLiveMode wrong', `got=${health.smsLiveMode}`)
        if (!hasEnrollmentCounts)  fail('activeEnrollments missing')
        if (!hasHandoffCounts)     fail('openHandoffTasks missing')
        if (!has24hStats)          fail('messagesLast24h missing')
      }
    } catch (err) {
      fail('unexpected error', String(err))
    }
    record(ok)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. Tenant pause blocks automation and appears in health
  // ══════════════════════════════════════════════════════════════════════════
  head('6. Tenant pause → automationPaused=true in health')
  {
    let ok = false
    try {
      await pauseTenantAutomation(tenantId)
      const health = await getAutomationHealth(tenantId)

      if (health?.tenant.automationPaused === true) {
        pass('automationPaused=true visible in health after pause')
        ok = true
      } else {
        fail('automationPaused not reflected in health', `got=${health?.tenant.automationPaused}`)
      }

      // Restore
      await resumeTenantAutomation(tenantId)
      const restored = await getAutomationHealth(tenantId)
      if (restored?.tenant.automationPaused === false) {
        pass('automationPaused=false after resume')
      } else {
        fail('automationPaused not restored', `got=${restored?.tenant.automationPaused}`)
        ok = false
      }
    } catch (err) {
      // Best-effort restore
      await resumeTenantAutomation(tenantId).catch(() => {})
      fail('unexpected error', String(err))
    }
    record(ok)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. Suppression report groups leads by reason
  // ══════════════════════════════════════════════════════════════════════════
  head('7. Suppression report groups leads by reason')
  {
    let ok = false
    try {
      // Seed leads with different suppression reasons
      await seedLead(tenantId, 'supp-test1', { suppressionReason: 'do_not_automate', state: 'stale' })
      await seedLead(tenantId, 'supp-test2', { suppressionReason: 'do_not_automate', state: 'stale' })
      await seedLead(tenantId, 'supp-test3', { suppressionReason: 'opted_out',       state: 'opted_out' })

      const report = await getSuppressionReport(tenantId)

      const hasDoNotAutomate = (report.summary['do_not_automate'] ?? 0) >= 2
      const hasOptedOut      = (report.summary['opted_out'] ?? 0) >= 1
      const hasByReason      = Array.isArray(report.byReason['do_not_automate'])

      if (hasDoNotAutomate && hasOptedOut && hasByReason) {
        pass('do_not_automate group present', `count=${report.summary['do_not_automate']}`)
        pass('opted_out group present',       `count=${report.summary['opted_out']}`)
        pass('byReason entries have lead data')
        ok = true
      } else {
        if (!hasDoNotAutomate) fail('do_not_automate count wrong', `got=${report.summary['do_not_automate']}`)
        if (!hasOptedOut)      fail('opted_out count wrong',       `got=${report.summary['opted_out']}`)
        if (!hasByReason)      fail('byReason not grouped correctly')
      }
    } catch (err) {
      fail('unexpected error', String(err))
    }
    record(ok)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 8. Message audit shows skipped/blocked sends with skip_reason
  // ══════════════════════════════════════════════════════════════════════════
  head('8. Message audit shows skipped sends with skip_reason')
  {
    let ok = false
    try {
      const lead = await seedLead(tenantId, 'msg-audit')
      const conv = await seedConversation(tenantId, lead.id, tenantPhoneNum, lead.phone)
      await seedSkippedMessage(conv.id, 'sms_not_live')
      await seedSkippedMessage(conv.id, 'do_not_automate')

      // skipReasonOnly filter
      const skippedOnly = await getMessageAuditLog(tenantId, { skipReasonOnly: true })
      const reasons = skippedOnly.map(m => m.skipReason)

      const hasSmsNotLive   = reasons.includes('sms_not_live')
      const hasDoNotAutomate = reasons.includes('do_not_automate')

      // All messages (no filter)
      const allMsgs = await getMessageAuditLog(tenantId, { leadId: lead.id })
      const hasLeadFilter = allMsgs.length >= 2 && allMsgs.every(m => m.lead.id === lead.id)

      if (hasSmsNotLive && hasDoNotAutomate && hasLeadFilter) {
        pass('sms_not_live appears in skipped-only audit', `total skipped: ${skippedOnly.length}`)
        pass('do_not_automate appears in skipped-only audit')
        pass('leadId filter returns only that lead\'s messages', `count=${allMsgs.length}`)
        ok = true
      } else {
        if (!hasSmsNotLive)     fail('sms_not_live not found in audit')
        if (!hasDoNotAutomate)  fail('do_not_automate not found in audit')
        if (!hasLeadFilter)     fail('leadId filter not working correctly')
      }
    } catch (err) {
      fail('unexpected error', String(err))
    }
    record(ok)
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  for (const id of cleanupLeadIds) {
    await db.delete(leads).where(eq(leads.id, id)).catch(() => {})
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  head('SUMMARY')
  const color = failed === 0 ? '\x1b[32m' : '\x1b[31m'
  log(`  ${color}${BOLD}${passed} passed  |  ${failed} failed${RESET}`)
  sep()
  log('')

  const outPath = '/tmp/dlr-admin-visibility-verify.txt'
  const { writeFileSync } = await import('fs')
  writeFileSync(outPath, lines.join('\n') + '\n')
  console.log(`${DIM}Full output saved to ${outPath}${RESET}\n`)

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('\nVerification crashed:', err)
  process.exit(1)
})
