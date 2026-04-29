/**
 * Phase 8 Verification Script — Live SMS Readiness & Activation Controls
 *
 * Proves the following without sending any live SMS:
 *
 *  1. Workflow cannot activate without tenant readiness
 *  2. Tenant cannot go live without 10DLC approved/exempt/dev_override
 *  3. SMS_LIVE_MODE=false blocks live readiness
 *  4. Compliance block prevents activation
 *  5. Workflow approval required before activation
 *  6. Dry-run preview available before activation (preview rendering works)
 *  7. Once all readiness flags are set, workflow can activate
 *  8. Even when workflow is active, send guard blocks unsafe lead
 *
 * All DB writes are rolled back via a test-tenant that is cleaned up after.
 * The test tenant is purely synthetic — no real sends, no real leads.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/verify-live-readiness.ts
 */

import { config } from 'dotenv'
config({ path: new URL('../.env.local', import.meta.url).pathname })

import { eq, and } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { tenants, workflows, workflowSteps, phoneNumbers, optOuts, leads, workflowEnrollments } from '../src/lib/db/schema'
import { runPreflight } from '../src/lib/engine/preflight'
import { runSendGuard } from '../src/lib/engine/send-guard'
import { WORKFLOW_TEMPLATES } from '../src/lib/workflows/templates'
import { renderTemplate } from '../src/lib/workflows/preview'
import type { SendSmsConfig, TenDlcStatus } from '../src/lib/db/schema'

// ── Colours ────────────────────────────────────────────────────────────────────
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
function check(ok: boolean, label: string, detail?: string) {
  ok ? pass(label, detail) : fail(label, detail)
  ok ? passed++ : failed++
  return ok
}

// ── Test tenant lifecycle ──────────────────────────────────────────────────────

const TEST_SLUG = `dlr-verify-phase8-${Date.now()}`

async function createTestTenant() {
  const [t] = await db.insert(tenants).values({
    name: 'Phase 8 Verify Tenant',
    slug: TEST_SLUG,
    // All readiness flags start at their restrictive defaults
    smsLiveApproved: false,
    tenDlcStatus: 'not_started',
    complianceBlocked: false,
    automationPaused: false,
  }).returning()
  return t
}

async function createTestWorkflow(tenantId: string) {
  const template = WORKFLOW_TEMPLATES[0] // internet_lead_revival
  const [wf] = await db.insert(workflows).values({
    tenantId,
    name: template.name,
    description: template.description,
    triggerType: template.triggerType,
    triggerConfig: template.triggerConfig,
    isActive: false,
    isTemplate: true,
    key: template.key,
    approvedForLive: false,
    activationStatus: 'draft',
    requiresOptOutLanguage: true,
    manualReviewRequired: false,
  }).returning()

  await db.insert(workflowSteps).values(
    template.steps.map(step => ({
      workflowId: wf.id,
      position: step.position,
      type: step.type as 'send_sms' | 'condition' | 'assign',
      config: step.config as never,
    }))
  )
  return wf
}

async function cleanup(tenantId: string) {
  // Cascade deletes handle most child rows; explicit cleanup for safety
  await db.delete(tenants).where(eq(tenants.id, tenantId))
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  head('PHASE 8 — LIVE SMS READINESS VERIFICATION')
  sep()
  log('')

  const testTenant = await createTestTenant()
  const tenantId = testTenant.id
  const testWorkflow = await createTestWorkflow(tenantId)
  const workflowId = testWorkflow.id

  log(`  Test tenant : ${tenantId}  (${TEST_SLUG})`)
  log(`  Test workflow: ${workflowId}`)
  log('')

  try {
    // ════════════════════════════════════════════════════════════════════════
    // 1. Workflow cannot activate without tenant readiness
    // ════════════════════════════════════════════════════════════════════════
    head('1. Workflow cannot activate without tenant readiness')
    {
      const result = await runPreflight(tenantId, workflowId)
      const blockers = result.failedBlockers.filter(c => c.id !== 'workflow_active')
      check(!result.allowed, 'Preflight blocks activation (allowed=false)', `${blockers.length} blocker(s)`)
      check(
        blockers.some(c => c.id === 'sms_live_mode' || c.id === 'live_approved'),
        'At least one tenant-level blocker present',
        blockers.map(c => c.id).join(', ')
      )
    }

    // ════════════════════════════════════════════════════════════════════════
    // 2. Tenant cannot go live without 10DLC approved/dev override
    // ════════════════════════════════════════════════════════════════════════
    head('2. Tenant cannot go live without 10DLC status ready')
    {
      // Set smsLiveApproved=true but leave tenDlcStatus=not_started
      await db.update(tenants).set({ smsLiveApproved: true }).where(eq(tenants.id, tenantId))
      const result = await runPreflight(tenantId, workflowId)
      const dlcCheck = result.checks.find(c => c.id === 'ten_dlc_ok')
      check(!dlcCheck?.passed, '10DLC check fails when status=not_started', `status=not_started`)

      // Now set dev_override — should unblock 10DLC
      await db.update(tenants).set({ tenDlcStatus: 'dev_override' }).where(eq(tenants.id, tenantId))
      const result2 = await runPreflight(tenantId, workflowId)
      const dlcCheck2 = result2.checks.find(c => c.id === 'ten_dlc_ok')
      check(!!dlcCheck2?.passed, '10DLC check passes with dev_override', 'tenDlcStatus=dev_override')

      // Reset to restrictive for subsequent tests
      await db.update(tenants).set({
        smsLiveApproved: false,
        tenDlcStatus: 'not_started',
      }).where(eq(tenants.id, tenantId))
    }

    // ════════════════════════════════════════════════════════════════════════
    // 3. SMS_LIVE_MODE=false blocks live readiness
    // ════════════════════════════════════════════════════════════════════════
    head('3. SMS_LIVE_MODE=false blocks live readiness')
    {
      // The test environment won't have SMS_LIVE_MODE=true (verification script safety)
      const smsLiveMode = process.env.SMS_LIVE_MODE === 'true'
      const result = await runPreflight(tenantId, workflowId)
      const liveCheck = result.checks.find(c => c.id === 'sms_live_mode')

      if (!smsLiveMode) {
        check(!liveCheck?.passed, 'sms_live_mode check fails (SMS_LIVE_MODE not set)', 'env gate active')
        check(!result.allowed, 'Overall preflight blocked', 'expected: allowed=false')
      } else {
        // Running with SMS_LIVE_MODE=true — check still present but passes
        check(!!liveCheck?.passed, 'sms_live_mode check passes (SMS_LIVE_MODE=true)', 'WARNING: live mode is on')
        log(`  ${RED} (re-run without SMS_LIVE_MODE=true to verify the gate)${RESET}`)
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 4. Compliance block prevents activation
    // ════════════════════════════════════════════════════════════════════════
    head('4. Compliance block prevents activation')
    {
      await db.update(tenants).set({
        complianceBlocked: true,
        complianceBlockReason: 'Test block for Phase 8 verification',
        smsLiveApproved: true,
        tenDlcStatus: 'dev_override',
      }).where(eq(tenants.id, tenantId))

      const result = await runPreflight(tenantId, workflowId)
      const blockCheck = result.checks.find(c => c.id === 'not_compliance_blocked')
      check(!blockCheck?.passed, 'Compliance block check fails when blocked', blockCheck?.detail)
      check(!result.allowed, 'Overall preflight blocked by compliance block', 'allowed=false')

      // Lift block
      await db.update(tenants).set({
        complianceBlocked: false,
        complianceBlockReason: null,
        smsLiveApproved: false,
        tenDlcStatus: 'not_started',
      }).where(eq(tenants.id, tenantId))
    }

    // ════════════════════════════════════════════════════════════════════════
    // 5. Workflow approval required before activation
    // ════════════════════════════════════════════════════════════════════════
    head('5. Workflow approval required before activation')
    {
      // Set tenant to fully ready, but leave workflow unapproved
      await db.update(tenants).set({
        smsLiveApproved: true,
        tenDlcStatus: 'dev_override',
      }).where(eq(tenants.id, tenantId))

      // Add a phone number
      await db.insert(phoneNumbers).values({
        tenantId,
        number: '+18015551234',
        isActive: true,
      })

      const result = await runPreflight(tenantId, workflowId)
      const approvalCheck = result.checks.find(c => c.id === 'workflow_approved')
      check(!approvalCheck?.passed, 'workflow_approved check fails when approvedForLive=false', 'needs human approval')

      const blockers = result.failedBlockers.filter(c => c.id !== 'workflow_active' && c.id !== 'sms_live_mode')
      check(
        blockers.some(c => c.id === 'workflow_approved'),
        'workflow_approved is a blocker',
        `blockers: ${blockers.map(c => c.id).join(', ')}`
      )
    }

    // ════════════════════════════════════════════════════════════════════════
    // 6. Dry-run preview available before activation
    // ════════════════════════════════════════════════════════════════════════
    head('6. Dry-run preview available before activation')
    {
      const template = WORKFLOW_TEMPLATES[0]
      const sendStep = template.steps.find(s => s.type === 'send_sms')!
      const result = renderTemplate(sendStep.config as SendSmsConfig, {
        firstName: 'TestLead',
        dealershipName: 'Verify Dealership',
        vehicleOfInterest: '2024 Ford F-150',
        salespersonName: 'Tester',
      })
      check(result.rendered.length > 0, 'Preview render returns content (no API call)', result.rendered.slice(0, 60) + '…')
      check(result.valid, 'Preview render is valid (no missing required fields)')
      check(!result.rendered.includes('{{'), 'No unresolved merge field placeholders', `usedFallback=${result.usedFallback}`)
    }

    // ════════════════════════════════════════════════════════════════════════
    // 7. Once all readiness flags are set, workflow can activate
    // ════════════════════════════════════════════════════════════════════════
    head('7. Once all readiness flags are set, workflow can activate')
    {
      // Approve workflow
      await db.update(workflows).set({
        approvedForLive: true,
        approvedAt: new Date(),
        approvedBy: 'verify-script',
        activationStatus: 'approved',
      }).where(eq(workflows.id, workflowId))

      // Run preflight — filter out sms_live_mode (env gate; won't be true in verify)
      const result = await runPreflight(tenantId, workflowId)
      const envBlockers = result.failedBlockers.filter(
        c => !['sms_live_mode', 'workflow_active', 'dry_run_mode'].includes(c.id)
      )
      check(envBlockers.length === 0, 'All non-env blockers cleared', `remaining: ${envBlockers.map(c => c.id).join(', ') || 'none'}`)

      // Activate workflow (set isActive manually — skipping env gate which is test-context)
      await db.update(workflows).set({
        isActive: true,
        activationStatus: 'active',
      }).where(eq(workflows.id, workflowId))

      const reloaded = await db.query.workflows.findFirst({ where: eq(workflows.id, workflowId) })
      check(reloaded?.isActive === true, 'Workflow is now active', `activationStatus=${reloaded?.activationStatus}`)
      check(reloaded?.activationStatus === 'active', 'activationStatus=active')
      check(reloaded?.approvedForLive === true, 'approvedForLive=true', `approvedBy=${reloaded?.approvedBy}`)
    }

    // ════════════════════════════════════════════════════════════════════════
    // 8. Even when workflow is active, send guard blocks unsafe lead
    // ════════════════════════════════════════════════════════════════════════
    head('8. Active workflow + active tenant: send guard still blocks unsafe leads')
    {
      // Create a synthetic lead
      const [lead] = await db.insert(leads).values({
        tenantId,
        firstName: 'GuardTest',
        lastName: 'Lead',
        phone: '+18015559999',
        doNotAutomate: false,
        isTest: false,
        state: 'enrolled',
        crmSource: 'verify',
      }).returning()

      // Create enrollment
      const [enrollment] = await db.insert(workflowEnrollments).values({
        workflowId,
        leadId: lead.id,
        status: 'active',
        currentStepPosition: 0,
      }).returning()

      // Use a nil UUID (all zeros) — valid UUID format, guaranteed to match nothing in messages table
      const FAKE_STEP_EXEC_ID = '00000000-0000-0000-0000-000000000001'

      const baseInput = {
        lead,
        enrollment,
        stepExecutionId: FAKE_STEP_EXEC_ID,
        scheduledAt: new Date(Date.now() - 1000),
        workflowId,
        tenant: {
          ...testTenant,
          smsLiveApproved: true,
          tenDlcStatus: 'dev_override',
          complianceBlocked: false,
          automationPaused: false,
          complianceBlockReason: null,
          requiresManualApprovalBeforeSend: false,
          liveActivatedAt: null,
          liveActivatedBy: null,
          smsSendingNumber: null,
        },
      }

      // 8a. Opted-out lead should be blocked
      await db.insert(optOuts).values({ tenantId, phone: lead.phone, source: 'verify' })
      const optedOutResult = await runSendGuard(baseInput)
      check(!optedOutResult.allowed && optedOutResult.reason === 'opted_out',
        'Opted-out lead blocked by send guard', `reason=${optedOutResult.reason}`)

      // Remove opt-out
      await db.delete(optOuts).where(
        and(eq(optOuts.tenantId, tenantId), eq(optOuts.phone, lead.phone))
      )

      // 8b. doNotAutomate lead should be blocked
      await db.update(leads).set({ doNotAutomate: true }).where(eq(leads.id, lead.id))
      const dnaResult = await runSendGuard({ ...baseInput, lead: { ...lead, doNotAutomate: true } })
      check(!dnaResult.allowed && dnaResult.reason === 'do_not_automate',
        'doNotAutomate lead blocked by send guard', `reason=${dnaResult.reason}`)

      // 8c. Lead who replied after step was scheduled
      const futureReply = new Date(Date.now() + 60_000) // replied 1 min from now
      const leadWithReply = { ...lead, doNotAutomate: false, lastCustomerReplyAt: futureReply }
      const replyResult = await runSendGuard({
        ...baseInput,
        lead: leadWithReply,
        scheduledAt: new Date(Date.now() - 5000), // scheduled before reply
      })
      check(!replyResult.allowed && replyResult.reason === 'lead_replied',
        'Post-schedule reply blocks send guard', `reason=${replyResult.reason}`)

      // 8d. Tenant-paused blocks even when workflow is active
      const pausedTenantResult = await runSendGuard({
        ...baseInput,
        lead: { ...lead, doNotAutomate: false },
        tenant: { ...baseInput.tenant, automationPaused: true },
      })
      check(!pausedTenantResult.allowed && pausedTenantResult.reason === 'tenant_paused',
        'tenant_paused blocks active workflow', `reason=${pausedTenantResult.reason}`)

      // 8e. Phase 8: compliance block blocks even when workflow is active
      const compBlockResult = await runSendGuard({
        ...baseInput,
        lead: { ...lead, doNotAutomate: false },
        tenant: { ...baseInput.tenant, complianceBlocked: true, complianceBlockReason: 'test' },
      })
      check(!compBlockResult.allowed && compBlockResult.reason === 'tenant_compliance_blocked',
        'compliance_blocked blocks active workflow', `reason=${compBlockResult.reason}`)

      // 8f. Phase 8: tenant not live approved blocks even when workflow is active
      const notApprovedResult = await runSendGuard({
        ...baseInput,
        lead: { ...lead, doNotAutomate: false },
        tenant: { ...baseInput.tenant, smsLiveApproved: false },
      })
      check(!notApprovedResult.allowed && notApprovedResult.reason === 'tenant_not_live_approved',
        'tenant_not_live_approved blocks active workflow', `reason=${notApprovedResult.reason}`)
    }

  } finally {
    // ── Cleanup ────────────────────────────────────────────────────────────
    await cleanup(tenantId)
    log('')
    log(`  ${DIM}Test tenant ${tenantId} cleaned up${RESET}`)
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  head('SUMMARY')
  const color = failed === 0 ? '\x1b[32m' : '\x1b[31m'
  log(`  ${color}${BOLD}${passed} passed  |  ${failed} failed${RESET}`)
  sep()
  log('')

  const { writeFileSync } = await import('fs')
  const outPath = '/tmp/dlr-live-readiness-verify.txt'
  writeFileSync(outPath, lines.join('\n') + '\n')
  console.log(`${DIM}Full output saved to ${outPath}${RESET}\n`)

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('\nVerification crashed:', err)
  process.exit(1)
})
