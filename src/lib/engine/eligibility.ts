/**
 * Eligibility / Suppression Agent
 *
 * This is the gatekeeper between stale lead detection and workflow enrollment.
 * No lead should ever be enrolled or texted without first passing through here.
 *
 * checkLeadEligibility()  — evaluates a single lead, returns a structured result.
 * runEligibilityPass()    — evaluates all stale/orphaned leads for a tenant,
 *                           transitions eligible ones to revival_eligible.
 *
 * Supports dry-run mode: pass { dryRun: true } to preview results without
 * writing any state transitions.
 */

import { and, eq, gt, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { leads, optOuts, tenants, workflowEnrollments } from '@/lib/db/schema'
import { transition } from '@/lib/lead/state-machine'
import { DEFAULT_COOLDOWN_DAYS } from '@/lib/messaging/send'

// ── Suppression reason helpers ────────────────────────────────────────────────

async function writeSuppressionReason(leadId: string, reason: string): Promise<void> {
  await db
    .update(leads)
    .set({ suppressionReason: reason, updatedAt: new Date() })
    .where(eq(leads.id, leadId))
}

async function clearSuppressionReason(leadId: string): Promise<void> {
  await db
    .update(leads)
    .set({ suppressionReason: null, updatedAt: new Date() })
    .where(eq(leads.id, leadId))
}

// How recently a lead must have been automated before we skip them again.
// Separate from workflow cooldown (which is about completing a full workflow).
// Guards against re-sending if an enrollment was cancelled mid-sequence.
const RECENTLY_CONTACTED_DAYS = Number(process.env.RECENTLY_CONTACTED_DAYS ?? 3)

// ── Types ─────────────────────────────────────────────────────────────────────

export type EligibilityReason =
  | 'ok'                  // passed all checks
  | 'is_test'             // lead.isTest = true
  | 'do_not_automate'     // lead.doNotAutomate = true
  | 'opted_out'           // in optOuts table or lead.state = opted_out
  | 'invalid_phone'       // phone is missing or not valid E.164
  | 'already_enrolled'    // active enrollment exists in any workflow
  | 'cooldown_active'     // completed a workflow within cooldown window
  | 'recently_contacted'  // lastAutomatedAt is too recent
  | 'tenant_paused'       // tenant.automationPaused = true
  | 'wrong_state'         // lead state is not stale or orphaned

export type EligibilityResult = {
  eligible: boolean
  reason: EligibilityReason
  detail?: string          // human-readable extra context
}

export type EligibilityPassSummary = {
  tenantId: string
  evaluated: number
  eligible: number
  suppressed: number
  dryRun: boolean
  byReason: Partial<Record<EligibilityReason, number>>
  leads: Array<{
    leadId: string
    name: string
    phone: string
    result: EligibilityResult
  }>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone)
}

// ── Single lead eligibility check ─────────────────────────────────────────────

/**
 * Evaluate whether a lead is eligible for revival workflow enrollment.
 * Pure evaluation — does NOT write any state transitions.
 *
 * Checks (in order):
 *  1. wrong_state         — must be stale or orphaned
 *  2. is_test             — hard block
 *  3. do_not_automate     — hard block
 *  4. invalid_phone       — must be valid E.164
 *  5. opted_out           — both lead state and optOuts table
 *  6. tenant_paused       — per-dealership kill switch
 *  7. already_enrolled    — active enrollment in any workflow
 *  8. cooldown_active     — completed a workflow within cooldown window
 *  9. recently_contacted  — lastAutomatedAt within RECENTLY_CONTACTED_DAYS
 */
export async function checkLeadEligibility(
  leadId: string,
  tenantId: string,
): Promise<EligibilityResult> {
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) })
  if (!lead) {
    return { eligible: false, reason: 'wrong_state', detail: 'Lead not found' }
  }

  // 1. State check — auto pipeline only processes stale or orphaned leads
  if (lead.state !== 'stale' && lead.state !== 'orphaned') {
    return {
      eligible: false,
      reason: 'wrong_state',
      detail: `Current state is '${lead.state}' — only stale/orphaned leads are evaluated`,
    }
  }

  // 2 & 3. Hard flags — check before any DB lookups
  if (lead.isTest) {
    return { eligible: false, reason: 'is_test' }
  }
  if (lead.doNotAutomate) {
    return { eligible: false, reason: 'do_not_automate' }
  }

  // 4. Phone validation
  if (!lead.phone || !isValidE164(lead.phone)) {
    return {
      eligible: false,
      reason: 'invalid_phone',
      detail: lead.phone ? `'${lead.phone}' is not valid E.164` : 'Phone number is missing',
    }
  }

  // 5. Opted out — check the opt-outs table (source of truth) in addition to lead state
  const optOutRecord = await db.query.optOuts.findFirst({
    where: and(eq(optOuts.tenantId, tenantId), eq(optOuts.phone, lead.phone)),
  })
  if (optOutRecord) {
    return { eligible: false, reason: 'opted_out', detail: `Opted out on ${optOutRecord.createdAt.toISOString()}` }
  }

  // 6. Tenant / dealership automation paused
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  if (tenant?.automationPaused) {
    return {
      eligible: false,
      reason: 'tenant_paused',
      detail: `Automation is paused for dealership '${tenant.name}'`,
    }
  }

  // 7. Already in an active workflow enrollment
  const activeEnrollment = await db.query.workflowEnrollments.findFirst({
    where: and(
      eq(workflowEnrollments.leadId, leadId),
      eq(workflowEnrollments.status, 'active'),
    ),
  })
  if (activeEnrollment) {
    return {
      eligible: false,
      reason: 'already_enrolled',
      detail: `Active enrollment ${activeEnrollment.id} (enrolled ${activeEnrollment.enrolledAt.toISOString()})`,
    }
  }

  // 8. Workflow cooldown — completed any workflow within the cooldown window
  const cooldownCutoff = new Date(Date.now() - DEFAULT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
  const recentCompleted = await db.query.workflowEnrollments.findFirst({
    where: and(
      eq(workflowEnrollments.leadId, leadId),
      eq(workflowEnrollments.status, 'completed'),
      gt(workflowEnrollments.completedAt, cooldownCutoff),
    ),
  })
  if (recentCompleted) {
    const cooldownUntil = new Date(
      recentCompleted.completedAt!.getTime() + DEFAULT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
    )
    return {
      eligible: false,
      reason: 'cooldown_active',
      detail: `Last workflow completed ${recentCompleted.completedAt!.toISOString()}. Cooldown lifts ${cooldownUntil.toISOString()}`,
    }
  }

  // 9. Recently contacted — guards against re-sending if a prior enrollment
  //    was cancelled mid-sequence but messages were already sent
  if (lead.lastAutomatedAt) {
    const recentCutoff = new Date(Date.now() - RECENTLY_CONTACTED_DAYS * 24 * 60 * 60 * 1000)
    if (lead.lastAutomatedAt > recentCutoff) {
      return {
        eligible: false,
        reason: 'recently_contacted',
        detail: `Last automated message sent ${lead.lastAutomatedAt.toISOString()} (within ${RECENTLY_CONTACTED_DAYS}-day window)`,
      }
    }
  }

  return { eligible: true, reason: 'ok' }
}

// ── Eligibility pass (runs across all stale/orphaned leads for a tenant) ──────

/**
 * Evaluate all stale and orphaned leads for a tenant.
 * Eligible leads are transitioned to revival_eligible.
 * Ineligible leads are logged with their suppression reason.
 *
 * Pass { dryRun: true } to preview results without writing any state changes.
 */
export async function runEligibilityPass(
  tenantId: string,
  opts: { dryRun?: boolean } = {},
): Promise<EligibilityPassSummary> {
  const { dryRun = false } = opts
  const dryLabel = dryRun ? ' [DRY RUN]' : ''

  // Pre-filter at query level: skip obvious non-starters before detailed checks
  const candidates = await db.query.leads.findMany({
    where: and(
      eq(leads.tenantId, tenantId),
      or(eq(leads.state, 'stale'), eq(leads.state, 'orphaned')),
      eq(leads.isTest, false),
      eq(leads.doNotAutomate, false),
    ),
  })

  const summary: EligibilityPassSummary = {
    tenantId,
    evaluated: candidates.length,
    eligible: 0,
    suppressed: 0,
    dryRun,
    byReason: {},
    leads: [],
  }

  if (candidates.length === 0) {
    console.log(`[eligibility]${dryLabel} Tenant ${tenantId}: no stale/orphaned candidates found`)
    return summary
  }

  for (const lead of candidates) {
    const result = await checkLeadEligibility(lead.id, tenantId)
    const name = `${lead.firstName} ${lead.lastName}`

    // Accumulate reason counts
    summary.byReason[result.reason] = (summary.byReason[result.reason] ?? 0) + 1
    summary.leads.push({ leadId: lead.id, name, phone: lead.phone, result })

    if (result.eligible) {
      summary.eligible++
      if (!dryRun) {
        await transition(lead.id, 'revival_eligible', {
          reason: 'Passed all suppression checks — queued for workflow enrollment',
        })
        // Clear any previous suppression reason — lead is now cleared
        await clearSuppressionReason(lead.id)
        console.log(`[eligibility] ✓ ${name} (${lead.id}) → revival_eligible`)
      } else {
        console.log(`[eligibility]${dryLabel} ✓ ${name} (${lead.id}) WOULD be marked revival_eligible`)
      }
    } else {
      summary.suppressed++
      const detail = result.detail ? ` — ${result.detail}` : ''
      console.log(`[eligibility]${dryLabel} ✗ ${name} (${lead.id}): ${result.reason}${detail}`)
      // Persist the suppression reason so it's visible in the admin UI / audit trail
      if (!dryRun) {
        const reasonText = result.detail ? `${result.reason}: ${result.detail}` : result.reason
        await writeSuppressionReason(lead.id, reasonText)
      }
    }
  }

  // Summary log
  const reasonSummary = Object.entries(summary.byReason)
    .map(([r, n]) => `${r}:${n}`)
    .join(', ')

  console.log(
    `[eligibility]${dryLabel} Tenant ${tenantId} — ` +
    `${summary.evaluated} evaluated | ` +
    `${summary.eligible} eligible | ` +
    `${summary.suppressed} suppressed | ` +
    `[${reasonSummary}]`
  )

  return summary
}
