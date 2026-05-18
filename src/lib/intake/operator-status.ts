/**
 * Operator status — single source of truth for "what's the next manual
 * step on this dealer intake?"
 *
 * Pure function: no DB calls, no side effects. The caller fetches the
 * pieces of data this needs (intake, tenant, extras, phone_numbers count,
 * dealer_invites count) and passes them in.
 *
 * Powers the "Operator Command Center" section at the top of
 * /admin/dlr/intakes/[intakeId] — surfaces the current blocker and the
 * one next manual action without the operator having to scan the
 * full 12-step checklist below.
 */

import type { InferSelectModel } from 'drizzle-orm'
import type { dealerIntakes, tenants } from '@/lib/db/schema'

type DealerIntake = InferSelectModel<typeof dealerIntakes>
type Tenant       = InferSelectModel<typeof tenants>

// ── State enum ────────────────────────────────────────────────────────────────

export type OperatorState =
  | 'intake_incomplete'
  | 'payment_pending'
  | 'tendlc_not_submitted'
  | 'tendlc_pending'
  | 'tendlc_approved_unprovisioned'
  | 'waiting_on_number'
  | 'workflow_needs_approval'
  | 'waiting_on_dealer_invite'
  | 'waiting_on_lead_upload'
  | 'ready_for_first_pilot'
  | 'first_pilot_sent'

// ── Progress strip ────────────────────────────────────────────────────────────

export type OperatorStep =
  | 'intake'
  | 'payment'
  | 'tendlc'
  | 'tenant'
  | 'number'
  | 'dealer_login'
  | 'leads'
  | 'pilot'

export const OPERATOR_STEP_ORDER: OperatorStep[] = [
  'intake', 'payment', 'tendlc', 'tenant',
  'number', 'dealer_login', 'leads', 'pilot',
]

export const OPERATOR_STEP_LABEL: Record<OperatorStep, string> = {
  intake:       'Intake',
  payment:      'Payment',
  tendlc:       '10DLC',
  tenant:       'Tenant',
  number:       'Number',
  dealer_login: 'Dealer Login',
  leads:        'Leads',
  pilot:        'Pilot',
}

export type StepStatus = 'done' | 'current' | 'pending'

// ── Public shape ──────────────────────────────────────────────────────────────

export type OperatorAction = {
  label:       string
  href?:       string   // when set, render as link (external if starts with http)
  actionKey?:  string   // when set, server-action call (e.g. 'provisionTenant')
  copyText?:   string   // when set, render as a "Copy" button
  external?:   boolean  // open in new tab
}

export type OperatorStatus = {
  state:       OperatorState
  label:       string                    // operator-facing one-liner: e.g. "Waiting on sending number"
  description: string                    // 1–2 sentences explaining the blocker
  primary:     OperatorAction | null     // the one big CTA; null for informational waiting states
  nextAfter:   string | null             // short hint of what comes after the primary action
  currentStep: OperatorStep
  stepStatus:  Record<OperatorStep, StepStatus>
}

// ── Inputs ────────────────────────────────────────────────────────────────────

export type OperatorStatusInputs = {
  intake:       DealerIntake
  tenant:       Tenant | null
  extras: {
    workflowApproved:  boolean
    pilotImportsExist: boolean
    pilotCompleted:    boolean
  }
  phoneCount:   number   // count of active phone_numbers rows for this tenant
  inviteCount:  number   // count of dealer_invites rows for this tenant
}

// ── The function ──────────────────────────────────────────────────────────────

export function computeOperatorStatus(p: OperatorStatusInputs): OperatorStatus {
  const { intake, tenant, extras, phoneCount, inviteCount } = p

  const paymentDone =
    intake.paymentStatus === 'paid' || intake.paymentStatus === 'manual_billing'
  const stage2Done   = !!intake.submittedAt
  const tendlcSubmitted = intake.launchStatus === '10dlc_pending' ||
                          intake.launchStatus === '10dlc_approved' ||
                          intake.launchStatus === 'provisioned' ||
                          intake.launchStatus === 'pilot_ready' ||
                          intake.launchStatus === 'live'
  const tendlcApproved  = intake.launchStatus === '10dlc_approved' ||
                          intake.launchStatus === 'provisioned' ||
                          intake.launchStatus === 'pilot_ready' ||
                          intake.launchStatus === 'live'
  const tenantProvisioned = !!intake.tenantId
  const numberAssigned    = !!tenant?.smsSendingNumber && phoneCount > 0
  const dealerCanLogIn    = inviteCount > 0

  // Build a step-status map. Each step is "done" once its precondition holds,
  // "current" if it's the next thing to do, "pending" otherwise.
  const stepStatus: Record<OperatorStep, StepStatus> = {
    intake:       stage2Done                        ? 'done' : 'pending',
    payment:      paymentDone                       ? 'done' : 'pending',
    tendlc:       tendlcApproved                    ? 'done' : 'pending',
    tenant:       tenantProvisioned                 ? 'done' : 'pending',
    number:       numberAssigned                    ? 'done' : 'pending',
    dealer_login: dealerCanLogIn                    ? 'done' : 'pending',
    leads:        extras.pilotImportsExist          ? 'done' : 'pending',
    pilot:        extras.pilotCompleted             ? 'done' : 'pending',
  }

  // Helper: build the result with `currentStep` set + stamp step as 'current'.
  function done(
    state:       OperatorState,
    currentStep: OperatorStep,
    label:       string,
    description: string,
    primary:     OperatorAction | null,
    nextAfter:   string | null,
  ): OperatorStatus {
    if (stepStatus[currentStep] !== 'done') stepStatus[currentStep] = 'current'
    return { state, label, description, primary, nextAfter, currentStep, stepStatus }
  }

  // ── Decision tree ─────────────────────────────────────────────────────────
  if (!paymentDone) {
    return done(
      'payment_pending',
      'payment',
      'Payment pending',
      `Dealer hasn't completed Stripe checkout yet (status: ${intake.paymentStatus}).`,
      {
        label:   'Copy intake link',
        copyText: `/intake/${intake.token}`,
      },
      'Wait for dealer to complete Stage 2 after paying.',
    )
  }

  if (!stage2Done) {
    return done(
      'intake_incomplete',
      'intake',
      'Intake incomplete',
      'Payment received but the dealer has not submitted the Stage 2 onboarding form.',
      {
        label:    'Copy intake link',
        copyText: `/intake/${intake.token}`,
      },
      'Submit 10DLC to TCR once intake is in.',
    )
  }

  if (!tendlcSubmitted) {
    return done(
      'tendlc_not_submitted',
      'tendlc',
      '10DLC not submitted',
      'Intake info is complete. Open the Telnyx portal, paste the compliance packet, then mark this submitted below.',
      {
        label:    'Open Telnyx 10DLC',
        href:     'https://portal.telnyx.com/#/messaging-10dlc/campaigns/new',
        external: true,
      },
      'Wait 1–3 weeks for carrier approval, then mark approved.',
    )
  }

  if (intake.launchStatus === '10dlc_pending') {
    return done(
      'tendlc_pending',
      'tendlc',
      '10DLC pending approval',
      'Brand + campaign submitted to TCR. Carrier approval typically takes 1–3 weeks; nothing to do until then.',
      null,
      'Mark approved once Telnyx confirms.',
    )
  }

  if (tendlcApproved && !tenantProvisioned) {
    return done(
      'tendlc_approved_unprovisioned',
      'tenant',
      '10DLC approved — ready to provision',
      'Carrier approved the brand/campaign. Create the DLR tenant from this intake to continue.',
      {
        label:     'Provision tenant',
        actionKey: 'provisionTenant',
      },
      'Assign a Telnyx number to the new tenant after provisioning.',
    )
  }

  if (tenantProvisioned && !numberAssigned) {
    return done(
      'waiting_on_number',
      'number',
      'Waiting on sending number',
      'Tenant provisioned and 10DLC approved, but no active Telnyx number is attached. Acquire a 10DLC number in the Telnyx portal, then attach it to this tenant.',
      {
        label:    'Open Telnyx Portal',
        href:     'https://portal.telnyx.com',
        external: true,
      },
      'After attaching, approve workflows for live send.',
    )
  }

  if (numberAssigned && !extras.workflowApproved) {
    return done(
      'workflow_needs_approval',
      'number', // workflow approval isn't its own step on the strip; surface under the active workflow phase
      'Workflow needs approval',
      'A Telnyx number is attached but no workflow has been approved for live sends yet.',
      {
        label: 'Go to Workflows',
        href:  '/admin/dlr/workflows',
      },
      'Generate a dealer-invite link once at least one workflow is approved.',
    )
  }

  if (extras.workflowApproved && !dealerCanLogIn) {
    return done(
      'waiting_on_dealer_invite',
      'dealer_login',
      'Generate dealer invite',
      'Workflows are approved. The dealer cannot log in yet — generate a one-time invite link and send it to them.',
      {
        label: 'Generate Dealer Invite',
        href:  '/admin/dlr/dealer-invite',
      },
      'Dealer logs in and uploads dead leads from /dealer/import.',
    )
  }

  if (dealerCanLogIn && !extras.pilotImportsExist) {
    return done(
      'waiting_on_lead_upload',
      'leads',
      'Waiting on dealer lead upload',
      'Invite sent — waiting for the dealer to log in and upload their dead-lead CSV.',
      null,
      'Review imported leads and create the first pilot batch.',
    )
  }

  if (extras.pilotImportsExist && !extras.pilotCompleted) {
    return done(
      'ready_for_first_pilot',
      'pilot',
      'Ready for first pilot',
      'Dealer has uploaded leads. Review them and prepare the first pilot batch.',
      {
        label: 'Go to Pilot Leads',
        href:  '/admin/dlr/pilot-leads',
      },
      'Run the smoke test, then send to the remaining leads.',
    )
  }

  // pilotCompleted
  return done(
    'first_pilot_sent',
    'pilot',
    'First pilot sent 🚀',
    'The first pilot batch is complete. Review results and decide on expansion.',
    {
      label: 'View Pilot Batches',
      href:  '/admin/dlr/pilot',
    },
    null,
  )
}

// ── Plain-text summary builder (for the Copy button) ──────────────────────────

export function buildOperatorSummary(
  dealershipName: string,
  intakeId:       string,
  status:         OperatorStatus,
  baseUrl:        string = 'https://dlr-sms.com',
): string {
  const adminUrl = `${baseUrl}/admin/dlr/intakes/${intakeId}`
  const lines: string[] = [
    `Dealer: ${dealershipName}`,
    `Status: ${status.label}`,
    `Next step: ${status.primary?.label ?? '(no action — waiting)'}`,
    `Admin URL: ${adminUrl}`,
  ]
  return lines.join('\n')
}
