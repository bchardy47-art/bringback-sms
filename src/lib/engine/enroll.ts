/**
 * Enrollment Agent
 *
 * enrollLead()          — enrolls a single lead into a workflow.
 *                         Requires lead.state === 'revival_eligible' by default.
 *                         Pass { skipStateCheck: true } for manual/admin enrollment.
 *
 * enrollEligibleLeads() — picks up all revival_eligible leads for a tenant and
 *                         enrolls them into matching active workflows.
 *                         This is Phase 3 of the worker pipeline.
 *
 * detectStaleLeads()    — Phase 1: marks inactive leads as stale (no enrollment).
 *
 * NOTE: autoEnrollStaleLeads() has been removed. The pipeline is now:
 *   Phase 1  detectStaleLeads()     marks active → stale
 *   Phase 2  runEligibilityPass()   (in eligibility.ts) marks stale → revival_eligible
 *   Phase 3  enrollEligibleLeads()  enrolls revival_eligible → enrolled
 */

import { and, eq, gt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { leads, tenants, workflowEnrollments, workflowSteps, workflows } from '@/lib/db/schema'
import { shouldStop } from './stop-conditions'
import { scheduleStep } from './scheduler'
import { transition } from '@/lib/lead/state-machine'
import { DEFAULT_COOLDOWN_DAYS } from '@/lib/messaging/send'
import type { SendSmsConfig, AssignConfig } from '@/lib/db/schema'

// ── Phone validation (belt-and-suspenders — eligibility.ts also checks) ───────
function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone)
}

// ── Enrollment ────────────────────────────────────────────────────────────────

export async function enrollLead(
  leadId: string,
  workflowId: string,
  opts: { skipStateCheck?: boolean } = {},
): Promise<{ enrollmentId: string } | { skipped: string }> {
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) })
  if (!lead) throw new Error(`Lead ${leadId} not found`)

  // ── State gate ────────────────────────────────────────────────────────────
  // Auto enrollment requires revival_eligible — the eligibility agent's stamp
  // that this lead has passed all suppression checks.
  // skipStateCheck allows manual/admin enrollment from other eligible states.
  if (!opts.skipStateCheck && lead.state !== 'revival_eligible') {
    return { skipped: `wrong_state:${lead.state}` }
  }

  // ── Belt-and-suspenders safety checks (also enforced by eligibility.ts) ──
  if (lead.isTest)                              return { skipped: 'is_test' }
  if (lead.doNotAutomate)                       return { skipped: 'do_not_automate' }
  if (!lead.phone || !isValidE164(lead.phone))  return { skipped: 'invalid_phone' }

  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, workflowId),
    with: { steps: true },
  })
  if (!workflow)         throw new Error(`Workflow ${workflowId} not found`)
  if (!workflow.isActive) return { skipped: 'workflow_inactive' }

  // ── Stop condition check (opted_out, dead, converted, etc.) ──────────────
  const stopReason = shouldStop({
    leadState: lead.state as Parameters<typeof shouldStop>[0]['leadState'],
    enrollmentStatus: 'active',
  })
  if (stopReason) return { skipped: stopReason }

  // ── Duplicate active enrollment guard ────────────────────────────────────
  const existing = await db.query.workflowEnrollments.findFirst({
    where: and(
      eq(workflowEnrollments.leadId, leadId),
      eq(workflowEnrollments.workflowId, workflowId),
      eq(workflowEnrollments.status, 'active'),
    ),
  })
  if (existing) return { skipped: 'already_enrolled' }

  // ── Per-workflow cooldown check ───────────────────────────────────────────
  const cooldownDays =
    (workflow.triggerConfig as { cooldownDays?: number })?.cooldownDays ?? DEFAULT_COOLDOWN_DAYS
  const cooldownCutoff = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000)

  const recentCompleted = await db.query.workflowEnrollments.findFirst({
    where: and(
      eq(workflowEnrollments.leadId, leadId),
      eq(workflowEnrollments.workflowId, workflowId),
      eq(workflowEnrollments.status, 'completed'),
      gt(workflowEnrollments.completedAt, cooldownCutoff),
    ),
  })
  if (recentCompleted) return { skipped: `cooldown_active:${cooldownDays}d` }

  // ── All gates passed — create enrollment ──────────────────────────────────
  const steps = workflow.steps.sort((a, b) => a.position - b.position)
  if (steps.length === 0) return { skipped: 'no_steps' }

  const [enrollment] = await db
    .insert(workflowEnrollments)
    .values({ workflowId, leadId, currentStepPosition: steps[0].position })
    .returning()

  await transition(leadId, 'enrolled', {
    reason: `Enrolled in workflow: ${workflow.name}`,
  })

  const firstStep = steps[0]
  const cfg = firstStep.config as SendSmsConfig | AssignConfig
  const delayMs = ('delayHours' in cfg && cfg.delayHours ? cfg.delayHours : 0) * 60 * 60 * 1000
  await scheduleStep(enrollment.id, firstStep.id, delayMs)

  console.log(`[enroll] Lead ${leadId} enrolled in workflow '${workflow.name}' (${workflowId})`)
  return { enrollmentId: enrollment.id }
}

// ── Phase 3: enroll all revival_eligible leads ────────────────────────────────
//
// Only picks up leads in revival_eligible state — these have already passed
// the eligibility/suppression pass. Any leads still in stale/orphaned state
// have been suppressed and are not touched here.

export async function enrollEligibleLeads(tenantId: string): Promise<number> {
  const activeWorkflows = await db.query.workflows.findMany({
    where: and(
      eq(workflows.tenantId, tenantId),
      eq(workflows.isActive, true),
      eq(workflows.triggerType, 'stale'),
    ),
  })

  if (activeWorkflows.length === 0) {
    console.log(`[enroll] Tenant ${tenantId}: no active stale-trigger workflows`)
    return 0
  }

  const eligibleLeads = await db.query.leads.findMany({
    where: and(
      eq(leads.tenantId, tenantId),
      eq(leads.state, 'revival_eligible'),
      eq(leads.isTest, false),
      eq(leads.doNotAutomate, false),
    ),
  })

  if (eligibleLeads.length === 0) return 0

  let enrolled = 0
  for (const lead of eligibleLeads) {
    for (const workflow of activeWorkflows) {
      const result = await enrollLead(lead.id, workflow.id)
      if ('enrollmentId' in result) {
        enrolled++
      } else {
        console.log(
          `[enroll] Lead ${lead.id} (${lead.firstName} ${lead.lastName}) ` +
          `skipped for workflow '${workflow.name}': ${result.skipped}`,
        )
      }
    }
  }

  console.log(`[enroll] Tenant ${tenantId}: ${enrolled} lead(s) enrolled from ${eligibleLeads.length} eligible`)
  return enrolled
}

// ── Phase 1: stale detection ──────────────────────────────────────────────────
//
// Marks active leads as stale when they have been inactive past the threshold.
// Does NOT enroll anyone — that is the eligibility agent's job.

export async function detectStaleLeads(tenantId: string): Promise<number> {
  const tenantRow = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  })
  const thresholdDays =
    (tenantRow?.settings as { staleThresholdDays?: number })?.staleThresholdDays ?? 14
  const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000)

  // Exclude test contacts and do-not-automate leads from stale detection entirely
  // — no point marking them stale since they'll never be enrolled anyway
  const activeLeads = await db.query.leads.findMany({
    where: and(
      eq(leads.tenantId, tenantId),
      eq(leads.state, 'active'),
      eq(leads.isTest, false),
      eq(leads.doNotAutomate, false),
    ),
  })

  let marked = 0
  for (const lead of activeLeads) {
    if (!lead.phone || !isValidE164(lead.phone)) continue

    const lastActivity = lead.lastCrmActivityAt ?? lead.createdAt
    if (lastActivity < cutoff) {
      await transition(lead.id, 'stale', {
        reason: `No CRM activity for ${thresholdDays}+ days`,
      })
      marked++
    }
  }

  if (marked > 0) {
    console.log(`[stale] Tenant ${tenantId}: ${marked} lead(s) marked stale (threshold: ${thresholdDays} days)`)
  }
  return marked
}
