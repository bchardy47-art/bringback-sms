/**
 * Phase 8 — Live SMS Preflight Readiness Checker
 *
 * Evaluates all conditions that must be true before a tenant + workflow
 * can send live SMS messages. This is the gate that sits above the
 * per-send-guard (send-guard.ts) and answers: "Is this system even
 * configured to be allowed to send?"
 *
 * runPreflight() is a pure read — it writes nothing and sends nothing.
 * The admin UI, activation API, and send guard all consult it.
 *
 * Checks (in order, all must pass for allowed=true):
 *
 *  TENANT LAYER
 *   1. sms_live_mode      — SMS_LIVE_MODE env var is true
 *   2. not_paused         — tenant.automationPaused = false
 *   3. live_approved      — tenant.smsLiveApproved = true
 *   4. ten_dlc_ok         — tenDlcStatus ∈ {approved, exempt, dev_override}
 *   5. has_sending_number — valid sending phone number exists for tenant
 *   6. not_compliance_blocked — tenant.complianceBlocked = false
 *
 *  WORKFLOW LAYER (only evaluated when workflowId is provided)
 *   7.  workflow_active      — workflow.isActive = true
 *   8.  workflow_approved    — workflow.approvedForLive = true
 *   9.  opt_out_language     — opt-out language present in step copy (when required)
 *   10. preview_reviewed     — activationStatus ≥ preview_ready (when manualReviewRequired)
 *
 *  INFORMATIONAL (not hard blockers, appear in result for UI display)
 *   11. manual_approval      — requiresManualApprovalBeforeSend flag status
 *   12. dry_run_mode         — whether DRY_RUN env is set
 */

import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { phoneNumbers, tenants, workflows, workflowSteps } from '@/lib/db/schema'
import type { TenDlcStatus, WorkflowActivationStatus, SendSmsConfig } from '@/lib/db/schema'

// ── Types ──────────────────────────────────────────────────────────────────────

export type CheckId =
  | 'sms_live_mode'
  | 'not_paused'
  | 'live_approved'
  | 'ten_dlc_ok'
  | 'has_sending_number'
  | 'not_compliance_blocked'
  | 'workflow_active'
  | 'workflow_approved'
  | 'opt_out_language'
  | 'preview_reviewed'
  | 'manual_approval_flag'
  | 'dry_run_mode'

export type PreflightCheck = {
  id: CheckId
  label: string
  /** true = check passed / safe */
  passed: boolean
  /** false = failure blocks activation entirely */
  isBlocker: boolean
  /** Human-readable explanation of why it passed or failed */
  detail: string
}

export type PreflightResult = {
  /** True only when ALL blocker checks pass */
  allowed: boolean
  tenantId: string
  workflowId?: string
  checks: PreflightCheck[]
  /** Subset of checks where isBlocker=true and passed=false */
  failedBlockers: PreflightCheck[]
  /** Summary label for display */
  summary: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const TEN_DLC_LIVE_STATUSES: TenDlcStatus[] = ['approved', 'exempt', 'dev_override']
const WORKFLOW_READY_STATUSES: WorkflowActivationStatus[] = ['preview_ready', 'approved', 'active', 'paused']

/** Check whether step copy contains opt-out language. */
function hasOptOutLanguage(body: string): boolean {
  return /\bSTOP\b/i.test(body) || /opt.?out/i.test(body)
}

/** Check whether a phone number looks like a valid E.164 number. */
function isValidPhone(num: string | null | undefined): boolean {
  if (!num) return false
  return /^\+[1-9]\d{6,14}$/.test(num)
}

// ── Main ───────────────────────────────────────────────────────────────────────

/**
 * Run all preflight readiness checks for a tenant, optionally scoped to a
 * specific workflow.
 *
 * @param tenantId  — UUID of the tenant to evaluate
 * @param workflowId — UUID of the workflow (omit for tenant-only check)
 */
export async function runPreflight(
  tenantId: string,
  workflowId?: string
): Promise<PreflightResult> {
  const checks: PreflightCheck[] = []

  // ── Load tenant ─────────────────────────────────────────────────────────────
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  })

  if (!tenant) {
    return {
      allowed: false,
      tenantId,
      workflowId,
      checks: [{
        id: 'live_approved',
        label: 'Tenant exists',
        passed: false,
        isBlocker: true,
        detail: `Tenant ${tenantId} not found`,
      }],
      failedBlockers: [{
        id: 'live_approved',
        label: 'Tenant exists',
        passed: false,
        isBlocker: true,
        detail: `Tenant ${tenantId} not found`,
      }],
      summary: 'Tenant not found',
    }
  }

  // ── Check 1: SMS_LIVE_MODE env ───────────────────────────────────────────────
  const smsLiveMode = process.env.SMS_LIVE_MODE === 'true'
  checks.push({
    id: 'sms_live_mode',
    label: 'SMS_LIVE_MODE=true',
    passed: smsLiveMode,
    isBlocker: true,
    detail: smsLiveMode
      ? 'Environment is configured for live sends'
      : 'SMS_LIVE_MODE is not set — all sends suppressed at the env level',
  })

  // ── Check 2: Automation not paused ──────────────────────────────────────────
  checks.push({
    id: 'not_paused',
    label: 'Automation not paused',
    passed: !tenant.automationPaused,
    isBlocker: true,
    detail: tenant.automationPaused
      ? `Automation is paused for "${tenant.name}" — resume before activating`
      : 'Automation is running normally',
  })

  // ── Check 3: Tenant live-send approved ──────────────────────────────────────
  checks.push({
    id: 'live_approved',
    label: 'Tenant live SMS approved',
    passed: tenant.smsLiveApproved,
    isBlocker: true,
    detail: tenant.smsLiveApproved
      ? `Live SMS approved${tenant.liveActivatedAt ? ` on ${tenant.liveActivatedAt.toISOString().slice(0, 10)}` : ''}`
      : 'DLR admin must approve this tenant for live sends via the readiness panel',
  })

  // ── Check 4: 10DLC status ────────────────────────────────────────────────────
  const tenDlcOk = TEN_DLC_LIVE_STATUSES.includes(tenant.tenDlcStatus as TenDlcStatus)
  const tenDlcLabels: Record<string, string> = {
    not_started:  'Not started — register at campaign-registry.com',
    pending:      'Registration submitted, awaiting approval',
    approved:     '10DLC campaign approved',
    rejected:     'Registration rejected — resolve issues before going live',
    exempt:       'Exempt (e.g. toll-free number)',
    dev_override: 'Dev/demo override — document before production use',
  }
  checks.push({
    id: 'ten_dlc_ok',
    label: '10DLC registration ready',
    passed: tenDlcOk,
    isBlocker: true,
    detail: tenDlcLabels[tenant.tenDlcStatus] ?? tenant.tenDlcStatus,
  })

  // ── Check 5: Valid sending number ────────────────────────────────────────────
  // Check smsSendingNumber field first, then fall back to phoneNumbers table.
  let sendingNumber: string | null = tenant.smsSendingNumber ?? null
  if (!sendingNumber) {
    const ph = await db.query.phoneNumbers.findFirst({
      where: and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.isActive, true)),
    })
    sendingNumber = ph?.number ?? null
  }
  const hasNumber = isValidPhone(sendingNumber)
  checks.push({
    id: 'has_sending_number',
    label: 'Valid sending number',
    passed: hasNumber,
    isBlocker: true,
    detail: hasNumber
      ? `Sending number: ${sendingNumber}`
      : 'No valid E.164 sending number found — add a phone number in the tenant settings',
  })

  // ── Check 6: No compliance block ────────────────────────────────────────────
  checks.push({
    id: 'not_compliance_blocked',
    label: 'No compliance block',
    passed: !tenant.complianceBlocked,
    isBlocker: true,
    detail: tenant.complianceBlocked
      ? `BLOCKED: ${tenant.complianceBlockReason ?? 'No reason given'}`
      : 'No active compliance block',
  })

  // ── Workflow checks (only when workflowId provided) ──────────────────────────
  if (workflowId) {
    const workflow = await db.query.workflows.findFirst({
      where: eq(workflows.id, workflowId),
      with: { steps: true },
    })

    if (!workflow) {
      checks.push({
        id: 'workflow_active',
        label: 'Workflow exists',
        passed: false,
        isBlocker: true,
        detail: `Workflow ${workflowId} not found`,
      })
    } else {
      // ── Check 7: Workflow is active ────────────────────────────────────────
      checks.push({
        id: 'workflow_active',
        label: 'Workflow is active',
        passed: workflow.isActive,
        isBlocker: true,
        detail: workflow.isActive
          ? `"${workflow.name}" is active`
          : `"${workflow.name}" is not active — activate it via the workflow panel`,
      })

      // ── Check 8: Workflow approved for live ───────────────────────────────
      checks.push({
        id: 'workflow_approved',
        label: 'Workflow approved for live sends',
        passed: workflow.approvedForLive,
        isBlocker: true,
        detail: workflow.approvedForLive
          ? `Approved${workflow.approvedBy ? ` by ${workflow.approvedBy}` : ''}${workflow.approvedAt ? ` on ${workflow.approvedAt.toISOString().slice(0, 10)}` : ''}`
          : 'A human reviewer must approve this workflow\'s message copy before live sends',
      })

      // ── Check 9: Opt-out language ─────────────────────────────────────────
      if (workflow.requiresOptOutLanguage) {
        const sendSteps = workflow.steps.filter(s => s.type === 'send_sms')
        const step1 = sendSteps[0]
        const firstStepHasOptOut = step1
          ? hasOptOutLanguage((step1.config as SendSmsConfig).template) ||
            hasOptOutLanguage((step1.config as SendSmsConfig).optOutFooter ?? '')
          : false
        checks.push({
          id: 'opt_out_language',
          label: 'Opt-out language in first message',
          passed: firstStepHasOptOut,
          isBlocker: true,
          detail: firstStepHasOptOut
            ? 'First message contains STOP / opt-out language'
            : 'First send_sms step must include "Reply STOP to opt out" or equivalent',
        })
      } else {
        checks.push({
          id: 'opt_out_language',
          label: 'Opt-out language (not required)',
          passed: true,
          isBlocker: false,
          detail: 'requiresOptOutLanguage is disabled for this workflow',
        })
      }

      // ── Check 10: Preview reviewed (when required) ─────────────────────────
      if (workflow.manualReviewRequired) {
        const previewReviewed = WORKFLOW_READY_STATUSES.includes(
          workflow.activationStatus as WorkflowActivationStatus
        )
        checks.push({
          id: 'preview_reviewed',
          label: 'Dry-run preview reviewed',
          passed: previewReviewed,
          isBlocker: true,
          detail: previewReviewed
            ? `Activation status: ${workflow.activationStatus}`
            : `Status is "${workflow.activationStatus}" — generate and review a dry-run preview first`,
        })
      } else {
        checks.push({
          id: 'preview_reviewed',
          label: 'Preview review (not required)',
          passed: true,
          isBlocker: false,
          detail: 'manualReviewRequired is disabled for this workflow',
        })
      }

      // ── Info 11: Manual approval flag ─────────────────────────────────────
      checks.push({
        id: 'manual_approval_flag',
        label: 'Per-send manual approval',
        passed: !tenant.requiresManualApprovalBeforeSend,
        isBlocker: false,
        detail: tenant.requiresManualApprovalBeforeSend
          ? 'WARN: each send requires manual approval (high-risk tenant flag)'
          : 'Standard send flow (no per-send manual approval)',
      })
    }
  }

  // ── Info 12: DRY_RUN mode ─────────────────────────────────────────────────
  const dryRun = process.env.DRY_RUN === 'true'
  checks.push({
    id: 'dry_run_mode',
    label: 'DRY_RUN mode',
    passed: !dryRun,
    isBlocker: false,
    detail: dryRun
      ? 'DRY_RUN=true — sends are logged but not submitted to Telnyx'
      : 'DRY_RUN is not set — sends will be submitted to Telnyx if all checks pass',
  })

  // ── Aggregate ─────────────────────────────────────────────────────────────
  const failedBlockers = checks.filter(c => c.isBlocker && !c.passed)
  const allowed = failedBlockers.length === 0

  const passCount = checks.filter(c => c.passed).length
  const summary = allowed
    ? `All checks passed (${passCount}/${checks.length})`
    : `${failedBlockers.length} blocker(s) must be resolved before live sends`

  return { allowed, tenantId, workflowId, checks, failedBlockers, summary }
}

// ── Tenant-only shorthand ──────────────────────────────────────────────────────

/** Run readiness check for the tenant without a specific workflow. */
export async function runTenantPreflight(tenantId: string): Promise<PreflightResult> {
  return runPreflight(tenantId)
}
