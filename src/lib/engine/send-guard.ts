/**
 * Send-Time Guard
 *
 * The final pre-send safety check that runs inside the executor immediately
 * before every outbound SMS attempt. This is the second layer of defense:
 *
 *   Layer 1 — Eligibility agent (pre-enrollment, runs on stale/orphaned leads)
 *   Layer 2 — Send-time guard  (pre-send, runs on every step execution)
 *
 * The guard is intentionally separate from send.ts. send.ts retains its own
 * SMS_LIVE_MODE check as a provider-level backstop, but the canonical decision
 * point for every outbound send is here.
 *
 * runSendGuard() is a pure evaluation function — it reads data but writes nothing.
 * The executor is responsible for acting on the result.
 *
 * Checks (in order):
 *  1. enrollment_not_active — enrollment must be active (fast exit)
 *  2. test_lead             — hard compliance block
 *  3. do_not_automate       — hard compliance block
 *  4. opted_out             — legal/compliance block
 *  5. invalid_phone         — E.164 validation
 *  6. lead_replied          — lead engaged after step was scheduled
 *  7. recent_human_contact  — human agent is handling this lead
 *  8. step_already_sent     — idempotency check
 *  9. tenant_paused         — per-dealership kill switch
 * 10. workflow_paused       — workflow deactivated
 * 11. sms_not_live          — SMS_LIVE_MODE env guard (fires after compliance)
 * 12. dry_run               — DRY_RUN env guard
 * 13. quiet_hours           — placeholder (always passes for now)
 * 14. missing_consent       — placeholder (always passes for now)
 *
 * Compliance and safety checks (1–8) run before env guards (11–12) so the
 * most meaningful reason is recorded even in dev/staging environments.
 */

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { leads, messages, optOuts, phoneNumbers, tenants, workflowEnrollments, workflows } from '@/lib/db/schema'
import { isInQuietHours, nextAllowedSend, type QuietHoursConfig } from './quiet-hours'
import { checkPerNumberRateLimit } from './send-rate-limit'

// ── Environment ───────────────────────────────────────────────────────────────

const SMS_LIVE_MODE = process.env.SMS_LIVE_MODE === 'true'
const DRY_RUN       = process.env.DRY_RUN === 'true'

// Hours after a human has manually contacted a lead before automation resumes.
const HUMAN_CONTACT_HOURS = Number(process.env.HUMAN_CONTACT_HOURS ?? 24)

// ── Types ─────────────────────────────────────────────────────────────────────

export type SendGuardReason =
  | 'ok'                    // all checks passed — send is allowed
  | 'sms_not_live'          // SMS_LIVE_MODE is not set
  | 'dry_run'               // DRY_RUN=true
  | 'test_lead'             // lead.isTest = true
  | 'do_not_automate'       // lead.doNotAutomate = true
  | 'opted_out'             // in optOuts table
  | 'invalid_phone'         // phone missing or not valid E.164
  | 'tenant_paused'         // tenant.automationPaused = true
  | 'tenant_not_live_approved'   // tenant.smsLiveApproved = false (Phase 8)
  | 'tenant_compliance_blocked'  // tenant.complianceBlocked = true (Phase 8)
  | 'tenant_10dlc_not_ready'     // tenDlcStatus not in approved/exempt/dev_override (Phase 8)
  | 'workflow_paused'       // workflow.isActive = false
  | 'workflow_not_approved' // workflow.approvedForLive = false (Phase 8)
  | 'enrollment_not_active' // enrollment.status !== 'active'
  | 'lead_replied'          // lead replied after step was scheduled
  | 'recent_human_contact'  // human agent contacted lead within HUMAN_CONTACT_HOURS
  | 'step_already_sent'     // message for this step execution already sent/delivered
  | 'quiet_hours'           // outside permitted send window (placeholder)
  | 'consent_revoked'       // lead.consentStatus = 'revoked' — hard stop (Phase 10)
  | 'missing_consent'       // lead.consentStatus = 'unknown' — soft skip (Phase 10)
  | 'rate_limited'          // per-number send budget exceeded — defer, do not cancel

export type SendGuardResult = {
  allowed: boolean
  reason: SendGuardReason
  detail?: string           // human-readable context for logging and audit rows
  /**
   * For `quiet_hours` blocks: the earliest UTC time at which sending is
   * allowed again. Consumers should reschedule the step at this time instead
   * of skipping it.
   */
  retryAt?: Date
}

// ── Enrollment outcome categories ─────────────────────────────────────────────
//
// Used by the executor to decide what to do with the enrollment after a block.

// These reasons mean the lead should never be in this workflow — cancel it.
export const GUARD_CANCEL_REASONS: ReadonlySet<SendGuardReason> = new Set<SendGuardReason>([
  'test_lead',
  'do_not_automate',
  'opted_out',
  'invalid_phone',
  'lead_replied',   // they engaged — hand off to human, stop automation
  'consent_revoked', // explicit revocation — treat same as opt-out (Phase 10)
])

// These are soft/temporary blocks — skip this step but leave enrollment active.
export const GUARD_SKIP_REASONS: ReadonlySet<SendGuardReason> = new Set<SendGuardReason>([
  'sms_not_live',
  'dry_run',
  'tenant_paused',
  'tenant_not_live_approved',
  'tenant_compliance_blocked',
  'tenant_10dlc_not_ready',
  'workflow_paused',
  'workflow_not_approved',
  'quiet_hours',
  'recent_human_contact',
  'missing_consent',
  'rate_limited',
])

// ── Input ─────────────────────────────────────────────────────────────────────

export interface SendGuardInput {
  lead:            typeof leads.$inferSelect
  enrollment:      typeof workflowEnrollments.$inferSelect
  stepExecutionId: string
  scheduledAt:     Date   // step_execution.scheduled_at — used for lead_replied check
  // Pre-loaded optionals — guard will load them if absent
  tenant?:         typeof tenants.$inferSelect | null
  workflowId?:     string
}

// ── E.164 helper ──────────────────────────────────────────────────────────────

function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone)
}

// ── Guard ─────────────────────────────────────────────────────────────────────

/**
 * Evaluate all pre-send conditions for a single outbound SMS step.
 * Pure read — writes nothing. Call this immediately before sendMessage().
 */
export async function runSendGuard(input: SendGuardInput): Promise<SendGuardResult> {
  const { lead, enrollment, stepExecutionId, scheduledAt } = input

  // ── 1. Enrollment must be active (fast exit) ─────────────────────────────
  if (enrollment.status !== 'active') {
    return {
      allowed: false,
      reason: 'enrollment_not_active',
      detail: `Enrollment ${enrollment.id} has status '${enrollment.status}'`,
    }
  }

  // ── 2. Hard flag: isTest ──────────────────────────────────────────────────
  if (lead.isTest) {
    return {
      allowed: false,
      reason: 'test_lead',
      detail: `Lead ${lead.id} is flagged as a test contact`,
    }
  }

  // ── 3. Hard flag: doNotAutomate ───────────────────────────────────────────
  if (lead.doNotAutomate) {
    return {
      allowed: false,
      reason: 'do_not_automate',
      detail: `Lead ${lead.id} has do_not_automate = true`,
    }
  }

  // ── 4. Opted out ──────────────────────────────────────────────────────────
  if (!lead.phone) {
    return { allowed: false, reason: 'invalid_phone', detail: 'Phone number is missing' }
  }
  const optOut = await db.query.optOuts.findFirst({
    where: and(eq(optOuts.tenantId, lead.tenantId), eq(optOuts.phone, lead.phone)),
  })
  if (optOut) {
    return {
      allowed: false,
      reason: 'opted_out',
      detail: `Phone ${lead.phone} is in the opt-out list (recorded ${optOut.createdAt.toISOString()})`,
    }
  }

  // ── 5. Phone validation ───────────────────────────────────────────────────
  if (!isValidE164(lead.phone)) {
    return {
      allowed: false,
      reason: 'invalid_phone',
      detail: `'${lead.phone}' is not valid E.164 format`,
    }
  }

  // ── 6. Lead replied since this step was scheduled ─────────────────────────
  //
  // If the customer replied AFTER this step was queued, automation should hold.
  // The step can be retried or the human can take over — we don't auto-send
  // over a conversation that's already live.
  if (lead.lastCustomerReplyAt && lead.lastCustomerReplyAt > scheduledAt) {
    return {
      allowed: false,
      reason: 'lead_replied',
      detail:
        `Lead replied at ${lead.lastCustomerReplyAt.toISOString()}, ` +
        `after this step was scheduled at ${scheduledAt.toISOString()}`,
    }
  }

  // ── 7. Recent human contact ───────────────────────────────────────────────
  //
  // If a human agent or manager sent a message from the inbox within the
  // configured window, pause automation so we don't interrupt the conversation.
  if (lead.lastHumanContactAt) {
    const humanContactCutoff = new Date(
      Date.now() - HUMAN_CONTACT_HOURS * 60 * 60 * 1000
    )
    if (lead.lastHumanContactAt > humanContactCutoff) {
      return {
        allowed: false,
        reason: 'recent_human_contact',
        detail:
          `Human contact at ${lead.lastHumanContactAt.toISOString()} ` +
          `is within the ${HUMAN_CONTACT_HOURS}h automation pause window`,
      }
    }
  }

  // ── 8. Step already sent (idempotency) ────────────────────────────────────
  //
  // If this step execution already produced a sent or delivered message,
  // we have nothing to do — the step completed successfully on a prior attempt.
  const existingMessage = await db.query.messages.findFirst({
    where: and(
      eq(messages.stepExecutionId, stepExecutionId),
      inArray(messages.status, ['sent', 'delivered']),
    ),
  })
  if (existingMessage) {
    return {
      allowed: false,
      reason: 'step_already_sent',
      detail: `Step execution ${stepExecutionId} already produced message ${existingMessage.id} (status: ${existingMessage.status})`,
    }
  }

  // ── 9. Tenant kill switch ─────────────────────────────────────────────────
  const tenant = input.tenant
    ?? await db.query.tenants.findFirst({ where: eq(tenants.id, lead.tenantId) })
  if (tenant?.automationPaused) {
    return {
      allowed: false,
      reason: 'tenant_paused',
      detail: `Automation is paused for dealership '${tenant.name}'`,
    }
  }

  // ── 9a. Phase 8: Compliance block (hard stop) ─────────────────────────────
  if (tenant?.complianceBlocked) {
    return {
      allowed: false,
      reason: 'tenant_compliance_blocked',
      detail: `Tenant '${tenant.name}' has an active compliance block: ${tenant.complianceBlockReason ?? 'no reason given'}`,
    }
  }

  // ── 9b. Phase 8: Tenant live-send approval ────────────────────────────────
  //
  // smsLiveApproved must be explicitly granted by a DLR admin.
  // This runs AFTER compliance so the most informative reason is recorded.
  if (tenant && !tenant.smsLiveApproved) {
    return {
      allowed: false,
      reason: 'tenant_not_live_approved',
      detail: `Tenant '${tenant.name}' has not been approved for live SMS sends`,
    }
  }

  // ── 9c. Phase 8: 10DLC registration ──────────────────────────────────────
  const LIVE_DLC_STATUSES = ['approved', 'exempt', 'dev_override']
  if (tenant && !LIVE_DLC_STATUSES.includes(tenant.tenDlcStatus)) {
    return {
      allowed: false,
      reason: 'tenant_10dlc_not_ready',
      detail: `10DLC status '${tenant.tenDlcStatus}' is not approved for live sends`,
    }
  }

  // ── 10. Workflow must be active ───────────────────────────────────────────
  if (input.workflowId) {
    const workflow = await db.query.workflows.findFirst({
      where: eq(workflows.id, input.workflowId),
    })
    if (workflow && !workflow.isActive) {
      return {
        allowed: false,
        reason: 'workflow_paused',
        detail: `Workflow '${workflow.name}' (${input.workflowId}) is no longer active`,
      }
    }

    // ── 10a. Phase 8: Workflow must be approved for live ──────────────────
    if (workflow && !workflow.approvedForLive) {
      return {
        allowed: false,
        reason: 'workflow_not_approved',
        detail: `Workflow '${workflow.name}' has not been approved for live sends — approve it via the admin panel`,
      }
    }
  }

  // ── 10b. Phase 10: Consent check ─────────────────────────────────────────
  //
  // Runs before env guards so the most specific compliance reason is recorded
  // even in dev/staging environments (same pattern as Phase 8 compliance checks).
  //
  // 'revoked'  → hard stop (cancel enrollment) — treat same as an opt-out.
  // 'unknown'  → soft skip — leave enrollment active but do not send.
  // 'implied' / 'explicit' → pass.
  const consentStatus = lead.consentStatus ?? 'unknown'
  if (consentStatus === 'revoked') {
    return {
      allowed: false,
      reason: 'consent_revoked',
      detail: `Lead ${lead.id} has explicitly revoked SMS consent`,
    }
  }
  if (consentStatus === 'unknown') {
    return {
      allowed: false,
      reason: 'missing_consent',
      detail: `Lead ${lead.id} has unknown consent status — not safe for outbound SMS`,
    }
  }

  // ── 11. Environment: SMS_LIVE_MODE ────────────────────────────────────────
  //
  // Env check runs after all compliance checks so the most informative reason
  // is recorded. A test_lead reports 'test_lead', a revoked lead reports
  // 'consent_revoked' — never 'sms_not_live'.
  if (!SMS_LIVE_MODE && !DRY_RUN) {
    return {
      allowed: false,
      reason: 'sms_not_live',
      detail: 'SMS_LIVE_MODE is not set — blocked at send-time guard',
    }
  }

  // ── 12. Environment: DRY_RUN ─────────────────────────────────────────────
  if (DRY_RUN) {
    return {
      allowed: false,
      reason: 'dry_run',
      detail: 'DRY_RUN=true — send logged but not submitted to provider',
    }
  }

  // ── 13. Quiet hours ──────────────────────────────────────────────────────
  //
  // Per-tenant quiet-hours window — defaults to 20:00–09:00 America/Los_Angeles
  // when not configured (TCPA-conservative). Blocked sends return a `retryAt`
  // hint so the executor can DEFER (reschedule) rather than SKIP the step.
  const now = new Date()
  const quietCfg = (tenant?.settings ?? {}).quietHours as QuietHoursConfig | undefined
  if (isInQuietHours(now, quietCfg)) {
    const resumeAt = nextAllowedSend(now, quietCfg) ?? undefined
    return {
      allowed: false,
      reason: 'quiet_hours',
      detail: `Quiet hours active — ${resumeAt ? `next send after ${resumeAt.toISOString()}` : 'no allowed window today'}`,
      retryAt: resumeAt,
    }
  }

  // ── 14. Per-number rate limit ────────────────────────────────────────────
  // Counts recent outbound messages from this tenant's sending number against
  // per-minute / per-hour / per-day caps. Blocks (with retryAt) when any window
  // is full so the executor reschedules instead of skipping permanently.
  const sendingNumber =
    tenant?.smsSendingNumber ??
    (await db.query.phoneNumbers.findFirst({
      where: and(eq(phoneNumbers.tenantId, lead.tenantId), eq(phoneNumbers.isActive, true)),
      columns: { number: true },
    }))?.number
  if (sendingNumber) {
    const rl = await checkPerNumberRateLimit(sendingNumber, now)
    if (!rl.allowed) {
      return {
        allowed: false,
        reason: 'rate_limited',
        detail: rl.detail,
        retryAt: rl.retryAt,
      }
    }
  }

  return { allowed: true, reason: 'ok' }
}
