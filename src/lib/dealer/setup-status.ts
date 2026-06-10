/**
 * Dealer setup status — what the dealer sees on /dealer/dashboard.
 *
 * Pure function: no DB calls, no side effects. The caller fetches:
 *   - the dealer's tenant row (for tenDlcStatus, sms_sending_number,
 *     smsLiveApproved, automationPaused, complianceBlocked)
 *   - the dealer_intake row (for paymentStatus, submittedAt)
 *   - simple counts (lead imports, draft/approved/completed batches)
 *
 * Powers the "DLR Setup Progress" panel above the dashboard stat cards.
 * Surfaces in dealer-friendly language only — no internal jargon
 * ("10DLC" is reframed as "carrier registration", "draft batch" as
 * "pilot review", etc.). Mirrors the operator-side
 * src/lib/intake/operator-status.ts but tailored to the dealer's POV.
 */

import type { InferSelectModel } from 'drizzle-orm'
import type { dealerIntakes, tenants } from '@/lib/db/schema'

type DealerIntake = InferSelectModel<typeof dealerIntakes>
type Tenant       = Pick<
  InferSelectModel<typeof tenants>,
  | 'tenDlcStatus'
  | 'smsSendingNumber'
  | 'smsLiveApproved'
  | 'automationPaused'
  | 'complianceBlocked'
>

// ── Public shape ──────────────────────────────────────────────────────────────

export type DealerStepStatus =
  | 'done'
  | 'in_progress'
  | 'waiting_on_dlr'
  | 'needs_your_action'
  | 'not_started'

export type DealerSetupStep = {
  key:    string
  label:  string
  status: DealerStepStatus
  /** 1-line, dealer-facing explanation. null when there's nothing useful to add. */
  detail: string | null
}

export type DealerSetupOverall = 'in_setup' | 'live_ready' | 'blocked'

export type DealerSetupStatus = {
  steps:      DealerSetupStep[]
  overall:    DealerSetupOverall
  /** When false, the dashboard should hide the progress panel entirely. */
  showPanel:  boolean
  /** Panel heading. */
  title:      string
  /** Panel subtitle / reassurance copy. */
  subtitle:   string
  /** Optional dealer-friendly "what's the very next thing" hint. null for blocked. */
  nextHint:   string | null
}

export type DealerSetupInputs = {
  intake: DealerIntake | null
  tenant: Tenant | null
  counts: {
    leadImports:       number
    draftBatches:      number
    approvedBatches:   number
    completedBatches:  number
    openConversations: number
  }
}

// ── Compute ───────────────────────────────────────────────────────────────────

export function computeDealerSetupStatus(p: DealerSetupInputs): DealerSetupStatus {
  const { intake, tenant, counts } = p

  // ── Per-step derivation ────────────────────────────────────────────────────
  const account: DealerSetupStep = {
    key: 'account', label: 'Account created',
    status: 'done',
    detail: null,
  }

  const paid =
    intake?.paymentStatus === 'paid' ||
    intake?.paymentStatus === 'manual_billing'
  const payment: DealerSetupStep = {
    key: 'payment', label: 'Payment received',
    status: paid ? 'done' : 'needs_your_action',
    detail: paid
      ? null
      : 'Click Complete payment to unlock campaign review and final launch activation.',
  }

  const stage2Done = !!intake?.submittedAt
  const form: DealerSetupStep = {
    key: 'form', label: 'Setup form submitted',
    status: stage2Done ? 'done' : (paid ? 'needs_your_action' : 'not_started'),
    detail: stage2Done
      ? null
      : paid
        ? 'Click Open setup form to share your dealership details.'
        : 'Available after payment.',
  }

  const tendlcStatus = tenant?.tenDlcStatus ?? null
  let tendlc: DealerSetupStep
  if (tendlcStatus === 'approved' || tendlcStatus === 'exempt') {
    tendlc = { key: 'tendlc', label: 'Carrier verification', status: 'done', detail: null }
  } else if (tendlcStatus === 'pending') {
    tendlc = {
      key: 'tendlc', label: 'Carrier verification',
      status: 'in_progress',
      detail: 'Carrier verification is in progress. This usually takes 1–3 weeks.',
    }
  } else if (tendlcStatus === 'rejected') {
    tendlc = {
      key: 'tendlc', label: 'Carrier verification',
      status: 'waiting_on_dlr',
      detail: 'Carrier feedback received. DLR is preparing a resubmission.',
    }
  } else if (stage2Done) {
    tendlc = {
      key: 'tendlc', label: 'Carrier verification',
      status: 'waiting_on_dlr',
      detail: 'DLR will submit your dealership to the carriers for SMS approval.',
    }
  } else {
    tendlc = {
      key: 'tendlc', label: 'Carrier verification',
      status: 'not_started',
      detail: 'Starts after the setup form is in.',
    }
  }

  const tendlcApproved = tendlcStatus === 'approved' || tendlcStatus === 'exempt'
  const numberAssigned = !!tenant?.smsSendingNumber
  let number: DealerSetupStep
  if (numberAssigned) {
    number = { key: 'number', label: 'Sending number assigned', status: 'done', detail: null }
  } else if (tendlcApproved) {
    number = {
      key: 'number', label: 'Sending number assigned',
      status: 'waiting_on_dlr',
      detail: 'DLR is assigning your approved sending number.',
    }
  } else {
    number = {
      key: 'number', label: 'Sending number assigned',
      status: 'not_started',
      detail: 'Assigned after carrier registration is approved.',
    }
  }

  let leads: DealerSetupStep
  if (counts.leadImports > 0) {
    leads = {
      key: 'leads', label: 'Lead upload ready',
      status: 'done',
      detail: 'Message previews are ready — open Campaigns to review.',
    }
  } else if (paid && stage2Done) {
    leads = {
      key: 'leads', label: 'Lead upload ready',
      status: 'needs_your_action',
      detail: 'You can upload leads now. We\'ll prepare previews before anything is sent.',
    }
  } else {
    leads = {
      key: 'leads', label: 'Lead upload ready',
      status: 'not_started',
      detail: 'Available after payment and setup form are complete.',
    }
  }

  let pilot: DealerSetupStep
  if (counts.completedBatches > 0) {
    pilot = { key: 'pilot', label: 'Campaign review', status: 'done', detail: null }
  } else if (counts.draftBatches > 0) {
    pilot = {
      key: 'pilot', label: 'Campaign review',
      status: 'needs_your_action',
      detail: 'A campaign is waiting for your review and approval.',
    }
  } else if (counts.approvedBatches > 0) {
    pilot = {
      key: 'pilot', label: 'Campaign review',
      status: 'waiting_on_dlr',
      detail: 'You approved a campaign — DLR will start sending after final compliance checks.',
    }
  } else {
    pilot = {
      key: 'pilot', label: 'Campaign review',
      status: 'not_started',
      detail: 'Available after you upload leads and DLR prepares your campaigns.',
    }
  }

  let launch: DealerSetupStep
  if (tenant?.smsLiveApproved && counts.completedBatches > 0) {
    launch = { key: 'launch', label: 'Launch ready', status: 'done', detail: null }
  } else if (counts.completedBatches > 0) {
    launch = {
      key: 'launch', label: 'Launch ready',
      status: 'waiting_on_dlr',
      detail: 'First campaign complete — DLR is enabling ongoing live sends.',
    }
  } else {
    launch = { key: 'launch', label: 'Launch ready', status: 'not_started', detail: null }
  }

  const steps: DealerSetupStep[] = [
    account, payment, form, tendlc, number, leads, pilot, launch,
  ]

  // ── Serialize dealer-action steps ──────────────────────────────────────────
  // QA flagged the panel showing two "Action needed" buttons at once
  // (e.g. payment=needs_your_action AND pilot=needs_your_action when a
  // draft batch had been created but payment hadn't completed). That
  // breaks the guided-flow expectation. Walk the dealer-action steps in
  // their natural completion order; the first needs_your_action stays as
  // the actionable step, every later one is downgraded to 'not_started'
  // with a detail line explaining what unlocks it. The dashboard's
  // actionForStep() helper only emits an action button when status ===
  // 'needs_your_action', so this mutation alone is enough to remove the
  // duplicate button without touching the dashboard render code.
  //
  // 'form' and 'leads' already gate their needs_your_action branches on
  // upstream completion in the per-step logic above, so they're rarely
  // out of order. 'pilot' is the historical outlier — drafts can exist
  // independent of payment/form state — and is the step this pass
  // primarily catches. Treating all four uniformly future-proofs
  // against similar drift if a new step is added later.
  const DEALER_ACTION_ORDER = ['payment', 'form', 'leads', 'pilot'] as const
  const BLOCKED_DETAIL: Record<string, string> = {
    payment: 'Available after payment is complete.',
    form:    'Available after the setup form is submitted.',
    leads:   'Available after leads are uploaded.',
  }
  let earliestActionKey: string | null = null
  for (const key of DEALER_ACTION_ORDER) {
    const step = steps.find(s => s.key === key)
    if (!step) continue
    if (step.status !== 'needs_your_action') continue
    if (earliestActionKey === null) {
      earliestActionKey = key
      continue
    }
    step.status = 'not_started'
    step.detail = BLOCKED_DETAIL[earliestActionKey] ?? 'Available after the earlier step.'
  }

  // ── Overall verdict ────────────────────────────────────────────────────────
  let overall: DealerSetupOverall
  let title:   string
  let subtitle: string
  let nextHint: string | null

  if (tenant?.complianceBlocked || tenant?.automationPaused) {
    overall = 'blocked'
    title = 'Account paused'
    subtitle = tenant.complianceBlocked
      ? 'A compliance issue is on hold. DLR ops will reach out shortly with next steps.'
      : 'Automation is currently paused. DLR will re-enable it after a short review.'
    nextHint = null
  } else if (steps.every(s => s.status === 'done')) {
    overall = 'live_ready'
    title = ''
    subtitle = ''
    nextHint = null
  } else {
    overall = 'in_setup'
    title = 'DLR Setup Progress'
    subtitle =
      'We’re preparing your dealership for SMS launch. No messages will be sent ' +
      'until you approve your campaign and complete the final launch step with DLR.'

    // Surface a single concrete "next" line so the dealer knows what to do.
    const firstAction =
      steps.find(s => s.status === 'needs_your_action') ??
      steps.find(s => s.status === 'in_progress') ??
      steps.find(s => s.status === 'waiting_on_dlr') ??
      null
    nextHint = firstAction?.detail ?? null
  }

  return {
    steps,
    overall,
    showPanel: overall !== 'live_ready',
    title,
    subtitle,
    nextHint,
  }
}

// ── Status display tokens (consumed by the dashboard JSX) ────────────────────
//
// Kept in the same module so the dashboard import is a single line. Pure
// constants; no React, no DOM.

export const DEALER_STEP_STATUS_LABEL: Record<DealerStepStatus, string> = {
  done:               'Done',
  in_progress:        'In progress',
  waiting_on_dlr:     'Waiting on DLR',
  needs_your_action:  'Action needed',
  not_started:        'Not started',
}

/** DLR design-system badge classes (see globals.css .badge / .badge-* rules). */
export const DEALER_STEP_STATUS_CLASS: Record<DealerStepStatus, string> = {
  done:              'badge badge-green',
  in_progress:       'badge badge-amber',
  waiting_on_dlr:    'badge badge-ghost',
  needs_your_action: 'badge badge-red',
  not_started:       'badge badge-ghost',
}
