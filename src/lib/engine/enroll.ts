import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { leads, tenants, workflowEnrollments, workflowSteps, workflows } from '@/lib/db/schema'
import { shouldStop } from './stop-conditions'
import { scheduleStep } from './scheduler'
import { transition } from '@/lib/lead/state-machine'
import type { SendSmsConfig, AssignConfig } from '@/lib/db/schema'

export async function enrollLead(
  leadId: string,
  workflowId: string
): Promise<{ enrollmentId: string } | { skipped: string }> {
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) })
  if (!lead) throw new Error(`Lead ${leadId} not found`)

  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, workflowId),
    with: { steps: true },
  })
  if (!workflow) throw new Error(`Workflow ${workflowId} not found`)
  if (!workflow.isActive) return { skipped: 'workflow_inactive' }

  // Pre-enrollment stop check
  const stopReason = shouldStop({
    leadState: lead.state as Parameters<typeof shouldStop>[0]['leadState'],
    enrollmentStatus: 'active',
  })
  if (stopReason) return { skipped: stopReason }

  // Prevent duplicate active enrollment in same workflow
  const existing = await db.query.workflowEnrollments.findFirst({
    where: and(
      eq(workflowEnrollments.leadId, leadId),
      eq(workflowEnrollments.workflowId, workflowId),
      eq(workflowEnrollments.status, 'active')
    ),
  })
  if (existing) return { skipped: 'already_enrolled' }

  const steps = workflow.steps.sort((a, b) => a.position - b.position)
  if (steps.length === 0) return { skipped: 'no_steps' }

  // Create enrollment
  const [enrollment] = await db
    .insert(workflowEnrollments)
    .values({ workflowId, leadId, currentStepPosition: steps[0].position })
    .returning()

  // Transition lead to enrolled
  await transition(leadId, 'enrolled', {
    reason: `Enrolled in workflow: ${workflow.name}`,
  })

  // Schedule first step (delay = step's own delayHours, usually 0 for step 1)
  const firstStep = steps[0]
  const cfg = firstStep.config as SendSmsConfig | AssignConfig
  const delayMs = ('delayHours' in cfg && cfg.delayHours ? cfg.delayHours : 0) * 60 * 60 * 1000
  await scheduleStep(enrollment.id, firstStep.id, delayMs)

  return { enrollmentId: enrollment.id }
}

// Used by the stale-detection worker to auto-enroll matching leads
export async function autoEnrollStaleLeads(tenantId: string): Promise<number> {
  const activeWorkflows = await db.query.workflows.findMany({
    where: and(
      eq(workflows.tenantId, tenantId),
      eq(workflows.isActive, true),
      eq(workflows.triggerType, 'stale')
    ),
  })

  const staleLeads = await db.query.leads.findMany({
    where: and(eq(leads.tenantId, tenantId), eq(leads.state, 'stale')),
  })

  let enrolled = 0
  for (const lead of staleLeads) {
    for (const workflow of activeWorkflows) {
      const result = await enrollLead(lead.id, workflow.id)
      if ('enrollmentId' in result) enrolled++
    }
  }
  return enrolled
}

// Marks leads as stale when they've been inactive past the threshold
export async function detectStaleLeads(tenantId: string): Promise<number> {
  const tenantRow = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  })
  // Default to 14 days if not configured
  const thresholdDays = (tenantRow?.settings as { staleThresholdDays?: number })?.staleThresholdDays ?? 14
  const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000)

  const activeLeads = await db.query.leads.findMany({
    where: and(eq(leads.tenantId, tenantId), eq(leads.state, 'active')),
  })

  let marked = 0
  for (const lead of activeLeads) {
    const lastActivity = lead.lastCrmActivityAt ?? lead.createdAt
    if (lastActivity < cutoff) {
      await transition(lead.id, 'stale', { reason: `No activity for ${thresholdDays}+ days` })
      marked++
    }
  }
  return marked
}
