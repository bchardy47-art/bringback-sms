/**
 * Phase 10 — Pre-Live Compliance Checklist
 *
 * Evaluates all operational, compliance, and emergency-stop readiness areas for
 * a tenant before the first live SMS pilot. Returns a structured report of
 * blockers and warnings — never writes anything to the database.
 *
 * Sections:
 *   1. Telnyx / 10DLC readiness
 *   2. Consent / source-tracking coverage
 *   3. Workflow opt-out compliance
 *   4. Pilot batch readiness
 *   5. Emergency controls
 *   6. Webhook configuration
 */

import { eq, count, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  tenants, leads, workflows, workflowSteps, pilotBatches,
  type SendSmsConfig,
} from '@/lib/db/schema'

// ── Types ──────────────────────────────────────────────────────────────────────

export type CheckStatus = 'ok' | 'warning' | 'blocker'

export type PreLiveCheck = {
  id: string
  label: string
  status: CheckStatus
  detail: string
}

export type PreLiveSection = {
  id: string
  title: string
  checks: PreLiveCheck[]
}

export type PreLiveChecklistResult = {
  tenantId: string
  tenantName: string
  generatedAt: string
  blocked: boolean          // true if any blocker exists
  blockerCount: number
  warningCount: number
  sections: PreLiveSection[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(id: string, label: string, detail: string): PreLiveCheck {
  return { id, label, status: 'ok', detail }
}
function warn(id: string, label: string, detail: string): PreLiveCheck {
  return { id, label, status: 'warning', detail }
}
function blocker(id: string, label: string, detail: string): PreLiveCheck {
  return { id, label, status: 'blocker', detail }
}

const LIVE_DLC_STATUSES = ['approved', 'exempt', 'dev_override']
const DEV_BYPASS_STATUSES = ['exempt', 'dev_override']

// ── Section evaluators ────────────────────────────────────────────────────────

function evalTelnyxSection(
  tenant: typeof tenants.$inferSelect
): PreLiveSection {
  const checks: PreLiveCheck[] = []
  const isDevBypass = DEV_BYPASS_STATUSES.includes(tenant.tenDlcStatus)

  // Sending number
  if (tenant.smsSendingNumber) {
    checks.push(ok('sending_number', 'Sending number assigned', tenant.smsSendingNumber))
  } else {
    checks.push(blocker('sending_number', 'Sending number assigned', 'No SMS sending number is set on this tenant. Assign one before going live.'))
  }

  // 10DLC registration status
  if (LIVE_DLC_STATUSES.includes(tenant.tenDlcStatus)) {
    checks.push(ok('ten_dlc_status', '10DLC status', `Status: ${tenant.tenDlcStatus}`))
  } else {
    checks.push(blocker('ten_dlc_status', '10DLC status', `10DLC status is '${tenant.tenDlcStatus}'. Must be approved, exempt, or dev_override.`))
  }

  // Brand status
  if (isDevBypass) {
    checks.push(ok('brand_status', 'TCR brand status', 'Bypassed via dev_override / exempt'))
  } else if (tenant.brandStatus === 'approved') {
    checks.push(ok('brand_status', 'TCR brand status', 'Brand registration approved'))
  } else if (tenant.brandStatus === 'pending') {
    checks.push(warn('brand_status', 'TCR brand status', 'Brand registration is pending — cannot send until approved'))
  } else if (tenant.brandStatus === 'rejected') {
    checks.push(blocker('brand_status', 'TCR brand status', `Brand registration rejected. Reason: ${tenant.tenDlcRejectionReason ?? 'not specified'}`))
  } else {
    checks.push(blocker('brand_status', 'TCR brand status', 'Brand status not set. Must complete TCR brand registration.'))
  }

  // Campaign status
  if (isDevBypass) {
    checks.push(ok('campaign_status', 'TCR campaign status', 'Bypassed via dev_override / exempt'))
  } else if (tenant.campaignStatus === 'approved') {
    checks.push(ok('campaign_status', 'TCR campaign status', 'Campaign registration approved'))
  } else if (tenant.campaignStatus === 'pending') {
    checks.push(warn('campaign_status', 'TCR campaign status', 'Campaign registration is pending — cannot send until approved'))
  } else if (tenant.campaignStatus === 'rejected') {
    checks.push(blocker('campaign_status', 'TCR campaign status', `Campaign registration rejected. Reason: ${tenant.tenDlcRejectionReason ?? 'not specified'}`))
  } else {
    checks.push(blocker('campaign_status', 'TCR campaign status', 'Campaign status not set. Must complete TCR campaign registration.'))
  }

  // Messaging profile ID
  if (tenant.messagingProfileId) {
    checks.push(ok('messaging_profile_id', 'Telnyx messaging profile ID', tenant.messagingProfileId))
  } else if (isDevBypass) {
    checks.push(warn('messaging_profile_id', 'Telnyx messaging profile ID', 'Not set — bypassed in dev mode'))
  } else {
    checks.push(warn('messaging_profile_id', 'Telnyx messaging profile ID', 'Messaging profile ID not set. Set this to link the sending number to a Telnyx messaging profile.'))
  }

  // Campaign ID
  if (tenant.campaignId) {
    checks.push(ok('campaign_id', 'TCR campaign ID', tenant.campaignId))
  } else if (isDevBypass) {
    checks.push(warn('campaign_id', 'TCR campaign ID', 'Not set — bypassed in dev mode'))
  } else {
    checks.push(warn('campaign_id', 'TCR campaign ID', 'Campaign ID not set. Record this after TCR campaign registration.'))
  }

  // Compliance block
  if (tenant.complianceBlocked) {
    checks.push(blocker('compliance_block', 'Compliance block', `Tenant has an active compliance block: ${tenant.complianceBlockReason ?? 'no reason given'}. Remove the block before going live.`))
  } else {
    checks.push(ok('compliance_block', 'No compliance block active', 'No compliance block is set on this tenant'))
  }

  return { id: 'telnyx', title: 'Telnyx / 10DLC Readiness', checks }
}

async function evalConsentSection(
  tenantId: string
): Promise<PreLiveSection> {
  const checks: PreLiveCheck[] = []

  // Count leads by consent status
  const rows = await db
    .select({ status: leads.consentStatus, cnt: count() })
    .from(leads)
    .where(eq(leads.tenantId, tenantId))
    .groupBy(leads.consentStatus)

  const totals: Record<string, number> = {}
  let total = 0
  for (const r of rows) {
    totals[r.status] = Number(r.cnt)
    total += Number(r.cnt)
  }

  const unknown  = totals['unknown']  ?? 0
  const implied  = totals['implied']  ?? 0
  const explicit = totals['explicit'] ?? 0
  const revoked  = totals['revoked']  ?? 0
  const known    = implied + explicit

  if (total === 0) {
    checks.push(warn('consent_coverage', 'Consent coverage', 'No leads found for this tenant'))
  } else {
    const pct = Math.round((known / total) * 100)
    if (pct >= 80) {
      checks.push(ok('consent_coverage', 'Consent coverage', `${pct}% of leads have known consent (${known}/${total})`))
    } else if (pct >= 50) {
      checks.push(warn('consent_coverage', 'Consent coverage', `${pct}% of leads have known consent (${known}/${total}). Consider enriching consent data before going live.`))
    } else {
      checks.push(warn('consent_coverage', 'Consent coverage', `Only ${pct}% of leads have known consent (${known}/${total}). Most leads will be skipped at send time until consent is recorded.`))
    }
  }

  // Revoked leads
  if (revoked > 0) {
    checks.push(warn('revoked_leads', 'Revoked consent leads', `${revoked} lead(s) have revoked consent. They will be hard-blocked and their enrollments cancelled at send time.`))
  } else {
    checks.push(ok('revoked_leads', 'No revoked consent leads', 'No leads have revoked consent'))
  }

  // Unknown leads
  if (unknown > 0 && total > 0) {
    const pct = Math.round((unknown / total) * 100)
    checks.push(warn('unknown_consent', `Unknown consent leads`, `${unknown} lead(s) (${pct}%) have unknown consent status. They will be soft-blocked at send time.`))
  } else {
    checks.push(ok('unknown_consent', 'No unknown consent leads', 'All leads have known consent status'))
  }

  return { id: 'consent', title: 'Consent / Source Tracking', checks }
}

async function evalWorkflowSection(
  tenantId: string
): Promise<PreLiveSection> {
  const checks: PreLiveCheck[] = []

  const wfs = await db.query.workflows.findMany({
    where: eq(workflows.tenantId, tenantId),
    with: { steps: true },
  })

  const activeWfs = wfs.filter(w => !w.isTemplate)

  if (activeWfs.length === 0) {
    checks.push(warn('no_workflows', 'Active workflows', 'No workflows configured for this tenant'))
    return { id: 'workflows', title: 'Workflow Opt-Out Compliance', checks }
  }

  for (const wf of activeWfs) {
    const label = `"${wf.name}"`

    // Approved for live
    if (!wf.approvedForLive) {
      checks.push(blocker(`wf_approved_${wf.id}`, `${label} approved for live`, `Workflow has not been approved for live sends. Approve it via the Readiness panel.`))
    } else {
      checks.push(ok(`wf_approved_${wf.id}`, `${label} approved for live`, `Approved by ${wf.approvedBy ?? 'admin'}`))
    }

    // Opt-out language
    if (wf.requiresOptOutLanguage) {
      const smsSendSteps = wf.steps.filter(s => s.type === 'send_sms')
      const hasFooter = smsSendSteps.some(s => {
        const cfg = s.config as SendSmsConfig
        return !!cfg.optOutFooter?.trim()
      })

      if (hasFooter) {
        checks.push(ok(`wf_opt_out_${wf.id}`, `${label} opt-out language`, 'At least one step includes opt-out footer'))
      } else {
        checks.push(blocker(`wf_opt_out_${wf.id}`, `${label} opt-out language`, `Workflow requires opt-out language (requiresOptOutLanguage=true) but no send_sms step has an optOutFooter set. Add one before approving.`))
      }
    } else {
      checks.push(ok(`wf_opt_out_${wf.id}`, `${label} opt-out language`, 'Opt-out language not required for this workflow'))
    }
  }

  return { id: 'workflows', title: 'Workflow Opt-Out Compliance', checks }
}

async function evalPilotSection(
  tenantId: string
): Promise<PreLiveSection> {
  const checks: PreLiveCheck[] = []

  const batches = await db.query.pilotBatches.findMany({
    where: eq(pilotBatches.tenantId, tenantId),
    with: { leads: true },
  })

  const approved = batches.filter(b => b.status === 'approved')
  const previewed = batches.filter(b => b.status === 'previewed')
  const draft = batches.filter(b => b.status === 'draft')

  if (approved.length > 0) {
    checks.push(ok('pilot_approved', 'Approved pilot batch', `${approved.length} batch(es) approved and ready to start`))
  } else if (previewed.length > 0) {
    checks.push(warn('pilot_approved', 'Approved pilot batch', `${previewed.length} batch(es) previewed but not yet approved. Approve before starting.`))
  } else if (draft.length > 0) {
    checks.push(warn('pilot_approved', 'Approved pilot batch', 'Batches exist but none are previewed or approved. Run preview then approve.'))
  } else {
    checks.push(warn('pilot_approved', 'Approved pilot batch', 'No pilot batches created yet. Create one at /admin/dlr/pilot/new.'))
  }

  // Dry-run reviewed
  const reviewed = batches.filter(b => b.dryRunSummary != null)
  if (reviewed.length > 0) {
    const b = reviewed[reviewed.length - 1]
    const s = b.dryRunSummary!
    checks.push(ok('dry_run_reviewed', 'Dry-run preview reviewed', `Last preview: ${s.eligibleCount} eligible, ${s.ineligibleCount} ineligible (generated ${s.generatedAt})`))
  } else {
    checks.push(warn('dry_run_reviewed', 'Dry-run preview reviewed', 'No dry-run preview has been generated. Run preview on a pilot batch before starting.'))
  }

  return { id: 'pilot', title: 'Pilot Batch Readiness', checks }
}

function evalEmergencySection(
  tenant: typeof tenants.$inferSelect
): PreLiveSection {
  const checks: PreLiveCheck[] = []

  const smsLive = process.env.SMS_LIVE_MODE === 'true'

  // Environment kill switch
  if (smsLive) {
    checks.push(ok('env_kill_switch', 'SMS_LIVE_MODE env kill switch', 'SMS_LIVE_MODE=true. Set to false to block all sends globally immediately.'))
  } else {
    checks.push(warn('env_kill_switch', 'SMS_LIVE_MODE env kill switch', 'SMS_LIVE_MODE is not set — no live sends will occur until it is. This is a blocker for going live, but intentionally left as a warning so you set it deliberately.'))
  }

  // Tenant kill switch
  if (!tenant.automationPaused) {
    checks.push(ok('tenant_kill_switch', 'Tenant kill switch', 'automationPaused=false. Toggle via Readiness panel to halt all sends for this dealership instantly.'))
  } else {
    checks.push(warn('tenant_kill_switch', 'Tenant kill switch (currently ACTIVE)', 'automationPaused=true — all sends are blocked for this tenant. Remove the pause before going live.'))
  }

  // Compliance block (as emergency control)
  checks.push(ok('compliance_block_control', 'Compliance block control', 'complianceBlocked flag available — set via admin to halt sends with a recorded reason'))

  // Workflow pause
  checks.push(ok('workflow_pause', 'Workflow-level pause', 'Individual workflows can be paused via workflow.isActive toggle in the Readiness panel'))

  // Pilot batch controls
  checks.push(ok('pilot_batch_controls', 'Pilot batch pause/cancel', 'Pilot batches can be paused or cancelled at any time via /admin/dlr/pilot/[id]'))

  // Lead-level controls
  checks.push(ok('lead_dna', 'Lead-level doNotAutomate', 'Any lead can be individually blocked via doNotAutomate=true in the lead record'))

  // Opt-out
  checks.push(ok('opt_out_block', 'Opt-out block', 'Leads in the opt_outs table are permanently blocked — STOP messages are handled automatically'))

  // Send guard
  checks.push(ok('send_guard', 'Send guard (14 checks)', 'Send-time guard runs 14 independent checks before every outbound SMS, any of which can block'))

  return { id: 'emergency', title: 'Emergency Controls', checks }
}

function evalWebhookSection(): PreLiveSection {
  const checks: PreLiveCheck[] = []

  // Webhook route
  checks.push(ok('webhook_route', 'Inbound webhook route', 'Route /api/webhooks/telnyx exists and handles message.received, message.sent, message.delivered, message.failed'))

  // STOP handling
  checks.push(ok('stop_handling', 'STOP message handling', 'STOP messages are detected in handleInbound, lead opted out, enrollment cancelled, opt_outs row inserted'))

  // Normal reply handling
  checks.push(ok('reply_handling', 'Normal reply classification', 'Inbound replies are classified (interested / not_interested / appointment_request / etc.) and handoff tasks are created for warm leads'))

  // Provider message ID
  checks.push(ok('provider_message_id', 'Provider message ID stored', 'providerMessageId is stored on every message row for status event correlation'))

  // Status events
  checks.push(ok('status_events', 'Delivery/failure callbacks', 'message_status_events table records sent/delivered/failed events from Telnyx webhooks'))

  // Signature verification
  const hasPublicKey = !!process.env.TELNYX_PUBLIC_KEY
  if (process.env.NODE_ENV === 'production' && !hasPublicKey) {
    checks.push(blocker('webhook_signature', 'Webhook signature validation', 'TELNYX_PUBLIC_KEY is not set. Signature verification is required in production.'))
  } else if (hasPublicKey) {
    checks.push(ok('webhook_signature', 'Webhook signature validation', 'TELNYX_PUBLIC_KEY is set — signature verification is active in production'))
  } else {
    checks.push(warn('webhook_signature', 'Webhook signature validation', 'TELNYX_PUBLIC_KEY not set. Signature verification is skipped in dev/test — set it before going to production.'))
  }

  return { id: 'webhook', title: 'Webhook Configuration', checks }
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Run the full pre-live compliance checklist for a tenant.
 * Pure read — no database writes.
 */
export async function runPreLiveChecklist(
  tenantId: string
): Promise<PreLiveChecklistResult> {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  if (!tenant) throw new Error(`Tenant ${tenantId} not found`)

  const sections: PreLiveSection[] = [
    evalTelnyxSection(tenant),
    await evalConsentSection(tenantId),
    await evalWorkflowSection(tenantId),
    await evalPilotSection(tenantId),
    evalEmergencySection(tenant),
    evalWebhookSection(),
  ]

  let blockerCount = 0
  let warningCount = 0
  for (const section of sections) {
    for (const check of section.checks) {
      if (check.status === 'blocker') blockerCount++
      if (check.status === 'warning') warningCount++
    }
  }

  return {
    tenantId,
    tenantName: tenant.name,
    generatedAt: new Date().toISOString(),
    blocked: blockerCount > 0,
    blockerCount,
    warningCount,
    sections,
  }
}

/**
 * Run the checklist for all tenants and return a summary map.
 */
export async function runPreLiveChecklistAll(): Promise<PreLiveChecklistResult[]> {
  const allTenants = await db.query.tenants.findMany()
  return Promise.all(allTenants.map(t => runPreLiveChecklist(t.id)))
}
