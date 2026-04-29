/**
 * Phase 9 — Pilot Lead Eligibility Checker
 *
 * Determines whether a lead is eligible to be included in a pilot batch.
 * Runs at preview time (before any send) and records the result on
 * pilot_batch_leads.eligibilityResult.
 *
 * This is a subset of the full send guard — it checks the lead-level
 * compliance conditions that can be evaluated without an active enrollment.
 * The send guard still runs again immediately before each outbound message.
 *
 * Checks (in order):
 *   1. not_test         — lead.isTest = false
 *   2. not_dna          — lead.doNotAutomate = false
 *   3. valid_phone      — E.164 format
 *   4. not_opted_out    — not in optOuts table for this tenant
 *   5. eligible_state   — lead.state not in terminal states
 *   6. not_enrolled     — not already in an active enrollment for this workflow
 */

import { and, eq, inArray, ne } from 'drizzle-orm'
import { db } from '@/lib/db'
import { leads, optOuts, workflowEnrollments } from '@/lib/db/schema'
import type { PilotEligibilityResult } from '@/lib/db/schema'

// ── Types ──────────────────────────────────────────────────────────────────────

export type EligibilityCheckId =
  | 'not_test'
  | 'not_dna'
  | 'valid_phone'
  | 'not_opted_out'
  | 'eligible_state'
  | 'not_enrolled'

type EligibilityCheck = {
  id: EligibilityCheckId
  passed: boolean
  detail: string
}

// Lead states that permanently disqualify a lead from enrollment
const TERMINAL_STATES = ['opted_out', 'dead', 'converted'] as const

function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone)
}

// ── Eligibility checker ───────────────────────────────────────────────────────

/**
 * Check whether a single lead is eligible for a pilot batch.
 *
 * @param lead       — full lead row
 * @param tenantId   — tenant UUID (for opt-out lookup)
 * @param workflowId — workflow UUID (for duplicate-enrollment check)
 */
export async function checkLeadEligibility(
  lead: typeof leads.$inferSelect,
  tenantId: string,
  workflowId: string
): Promise<PilotEligibilityResult> {
  const checks: EligibilityCheck[] = []

  // ── 1. Not a test lead ──────────────────────────────────────────────────────
  checks.push({
    id: 'not_test',
    passed: !lead.isTest,
    detail: lead.isTest
      ? 'Lead is flagged as a test contact — excluded from pilot batches'
      : 'Not a test lead',
  })

  // ── 2. Not do-not-automate ──────────────────────────────────────────────────
  checks.push({
    id: 'not_dna',
    passed: !lead.doNotAutomate,
    detail: lead.doNotAutomate
      ? 'Lead has do_not_automate = true — hard compliance block'
      : 'Automation not restricted',
  })

  // ── 3. Valid E.164 phone ────────────────────────────────────────────────────
  const phoneOk = !!lead.phone && isValidE164(lead.phone)
  checks.push({
    id: 'valid_phone',
    passed: phoneOk,
    detail: phoneOk
      ? `Phone ${lead.phone} is valid E.164`
      : `Phone "${lead.phone ?? '(missing)'}" is not valid E.164 format`,
  })

  // ── 4. Not opted out ────────────────────────────────────────────────────────
  let optedOut = false
  if (lead.phone) {
    const optOut = await db.query.optOuts.findFirst({
      where: and(eq(optOuts.tenantId, tenantId), eq(optOuts.phone, lead.phone)),
    })
    optedOut = !!optOut
  }
  checks.push({
    id: 'not_opted_out',
    passed: !optedOut,
    detail: optedOut
      ? `Phone ${lead.phone} is on the opt-out list`
      : 'Not opted out',
  })

  // ── 5. Eligible state ───────────────────────────────────────────────────────
  const inTerminalState = TERMINAL_STATES.includes(lead.state as typeof TERMINAL_STATES[number])
  checks.push({
    id: 'eligible_state',
    passed: !inTerminalState,
    detail: inTerminalState
      ? `Lead state "${lead.state}" is terminal — cannot enroll`
      : `Lead state "${lead.state}" is eligible`,
  })

  // ── 6. Not already enrolled in this workflow ─────────────────────────────────
  const existingEnrollment = await db.query.workflowEnrollments.findFirst({
    where: and(
      eq(workflowEnrollments.leadId, lead.id),
      eq(workflowEnrollments.workflowId, workflowId),
      inArray(workflowEnrollments.status, ['active', 'paused']),
    ),
  })
  checks.push({
    id: 'not_enrolled',
    passed: !existingEnrollment,
    detail: existingEnrollment
      ? `Already has an active/paused enrollment (${existingEnrollment.id}) in this workflow`
      : 'No active enrollment in this workflow',
  })

  // ── Aggregate ───────────────────────────────────────────────────────────────
  const failedCheck = checks.find(c => !c.passed)
  const eligible = !failedCheck

  return {
    eligible,
    reason: failedCheck?.detail,
    checks: checks.map(c => ({ id: c.id, passed: c.passed, detail: c.detail })),
  }
}

/**
 * Check eligibility for a list of lead IDs and return a map of results.
 */
export async function checkBatchEligibility(
  leadIds: string[],
  tenantId: string,
  workflowId: string
): Promise<Map<string, PilotEligibilityResult>> {
  const results = new Map<string, PilotEligibilityResult>()

  // Load leads
  const leadRows = await db.query.leads.findMany({
    where: inArray(leads.id, leadIds),
  })

  for (const lead of leadRows) {
    const result = await checkLeadEligibility(lead, tenantId, workflowId)
    results.set(lead.id, result)
  }

  // Mark any leadIds that weren't found as ineligible
  for (const id of leadIds) {
    if (!results.has(id)) {
      results.set(id, {
        eligible: false,
        reason: 'Lead not found',
        checks: [{ id: 'not_test', passed: false, detail: 'Lead record not found in database' }],
      })
    }
  }

  return results
}
