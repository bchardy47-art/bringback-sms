/**
 * DLR Workflow Template Library
 *
 * Six pre-built dealership revival workflow templates. Each template is a
 * complete workflow definition that can be seeded into any tenant's account as
 * an inactive (dry-run-safe) starting point.
 *
 * Design principles applied to all message copy:
 *   - Short — under 160 chars where possible, never over 320
 *   - Human-sounding — no corporate stiffness, no fake urgency
 *   - One question per message
 *   - No pretending the AI is a specific human
 *   - Context-aware when vehicle/source data exists
 *   - Graceful fallback when context is missing
 *   - Stops immediately on any reply (enforced by send guard)
 *   - Easy opt-out (reply STOP) language present in at least one step per workflow
 *
 * Merge fields supported:
 *   {{firstName}}          — lead first name (required)
 *   {{dealershipName}}     — tenant display name (required)
 *   {{vehicleOfInterest}}  — vehicle string from CRM (optional)
 *   {{salespersonName}}    — original salesperson (optional)
 *
 * Each send_sms step includes a `fallbackTemplate` used when optional merge
 * fields are absent (e.g. vehicleOfInterest not captured).
 *
 * Step structure per workflow (3-message revival sequence):
 *   Position 1 — send_sms: soft re-open
 *   Position 2 — condition: stop if responded
 *   Position 3 — send_sms: useful/contextual follow-up
 *   Position 4 — condition: stop if responded
 *   Position 5 — send_sms: polite close-the-loop
 */

import type { WorkflowTriggerConfig, SendSmsConfig, ConditionConfig } from '@/lib/db/schema'

// ── Types ──────────────────────────────────────────────────────────────────────

export type WorkflowTemplateStep =
  | { type: 'send_sms'; position: number; config: SendSmsConfig }
  | { type: 'condition'; position: number; config: ConditionConfig }

export type WorkflowTemplate = {
  /** Unique slug — used for idempotent upserts */
  key: string
  name: string
  description: string
  triggerType: 'stale' | 'orphaned' | 'no_show' | 'manual'
  triggerConfig: WorkflowTriggerConfig
  steps: WorkflowTemplateStep[]
}

// ── Shared condition step factory ──────────────────────────────────────────────

function stopIfReplied(position: number): WorkflowTemplateStep {
  return {
    type: 'condition',
    position,
    config: {
      type: 'condition',
      field: 'lead.responded',
      operator: 'eq',
      value: 'true',
      ifTrue: 'stop',
      ifFalse: 'continue',
    },
  }
}

// ── Template 1: Old Internet Lead Revival ──────────────────────────────────────
// For leads who submitted a web/internet inquiry but never bought or went cold.
// Trigger: stale after 7+ days of no CRM activity.

const internetLeadRevival: WorkflowTemplate = {
  key: 'internet_lead_revival',
  name: 'Old Internet Lead Revival',
  description:
    'Re-engages leads who submitted an internet inquiry but stopped responding. '
    + 'Soft open-ended questions with no pressure. Stops the moment they reply.',
  triggerType: 'stale',
  triggerConfig: {
    daysInactive: 7,
    cooldownDays: 30,
    intendedLeadSource: 'Web/internet inquiry (Cars.com, AutoTrader, dealer website)',
    eligibilityNotes:
      'Lead state must be stale or revival_eligible. '
      + 'Lead must not be opted out, doNotAutomate, or already enrolled.',
    stopConditions: [
      'Any inbound reply',
      'Lead marked do_not_automate',
      'Lead opts out (STOP)',
      'Lead marked dead or converted',
    ],
    handoffConditions: [
      'Reply classified as interested, appointment_request, or callback_request',
      'Reply classified as angry_or_complaint',
    ],
    requiredMergeFields: ['firstName', 'dealershipName'],
    optionalMergeFields: ['vehicleOfInterest'],
    maxAttempts: 3,
  },
  steps: [
    {
      type: 'send_sms',
      position: 1,
      config: {
        type: 'send_sms',
        template:
          'Hey {{firstName}}, this is {{dealershipName}}. You reached out a while back about a vehicle — are you still in the market, or did you already find something? (Reply STOP to opt out)',
        fallbackTemplate:
          'Hey {{firstName}}, this is {{dealershipName}}. You reached out a while back about a vehicle — are you still in the market, or did you already find something? (Reply STOP to opt out)',
        delayHours: 0,
      },
    },
    stopIfReplied(2),
    {
      type: 'send_sms',
      position: 3,
      config: {
        type: 'send_sms',
        template:
          'No pressure at all — just wanted to follow up on the {{vehicleOfInterest}}. Still looking, or has your situation changed?',
        fallbackTemplate:
          'No pressure at all — just wanted to follow up. Still in the market, or has your situation changed?',
        delayHours: 72,
      },
    },
    stopIfReplied(4),
    {
      type: 'send_sms',
      position: 5,
      config: {
        type: 'send_sms',
        template:
          "I'll leave it here for now. If you're ever ready to explore options again, just reply and we'll pick up where we left off.",
        fallbackTemplate:
          "I'll leave it here for now. If you're ever ready to explore options again, just reply and we'll pick up where we left off.",
        delayHours: 120,
      },
    },
  ],
}

// ── Template 2: Aged Inventory Inquiry Revival ─────────────────────────────────
// For leads who asked about a specific vehicle days/weeks ago but didn't move forward.
// Vehicle context is central — fallback is softer when vehicle not captured.

const agedInventoryRevival: WorkflowTemplate = {
  key: 'aged_inventory_revival',
  name: 'Aged Inventory Inquiry Revival',
  description:
    'Re-engages leads who inquired about a specific vehicle but went quiet. '
    + 'References the vehicle when available. Gently checks if it\'s still relevant.',
  triggerType: 'stale',
  triggerConfig: {
    daysInactive: 14,
    cooldownDays: 45,
    intendedLeadSource: 'Vehicle detail page lead, inventory inquiry form, phone-up',
    eligibilityNotes:
      'Works best when vehicleOfInterest is populated. '
      + 'Lead state stale or revival_eligible. Not already enrolled.',
    stopConditions: [
      'Any inbound reply',
      'Lead opts out',
      'Lead marked dead or converted',
    ],
    handoffConditions: [
      'Reply classified as interested or appointment_request',
      'Lead asks about pricing, availability, or trade-in',
    ],
    requiredMergeFields: ['firstName', 'dealershipName'],
    optionalMergeFields: ['vehicleOfInterest'],
    maxAttempts: 3,
  },
  steps: [
    {
      type: 'send_sms',
      position: 1,
      config: {
        type: 'send_sms',
        template:
          'Hey {{firstName}}, following up from {{dealershipName}} — you reached out about the {{vehicleOfInterest}} a little while back. Still interested, or did you go a different direction? (Reply STOP to opt out)',
        fallbackTemplate:
          'Hey {{firstName}}, following up from {{dealershipName}} — you reached out about a vehicle a little while back. Still interested, or did you go a different direction? (Reply STOP to opt out)',
        delayHours: 0,
      },
    },
    stopIfReplied(2),
    {
      type: 'send_sms',
      position: 3,
      config: {
        type: 'send_sms',
        template:
          'We still have options similar to the {{vehicleOfInterest}} if timing works better now. Want me to check what\'s available?',
        fallbackTemplate:
          'We still have some good options available if the timing is better now. Want me to check what we have?',
        delayHours: 96,
      },
    },
    stopIfReplied(4),
    {
      type: 'send_sms',
      position: 5,
      config: {
        type: 'send_sms',
        template:
          "No worries if the timing wasn't right. We'll close the loop here — reply anytime if things change and we'll get you taken care of.",
        fallbackTemplate:
          "No worries if the timing wasn't right. We'll close the loop here — reply anytime if things change.",
        delayHours: 120,
      },
    },
  ],
}

// ── Template 3: Missed Appointment / No-Show Revival ──────────────────────────
// For leads who scheduled an appointment but did not show up.
// Tone is empathetic and non-judgmental — life happens.

const missedAppointmentRevival: WorkflowTemplate = {
  key: 'missed_appointment_revival',
  name: 'Missed Appointment / No-Show Revival',
  description:
    'Gently follows up with leads who scheduled but did not appear. '
    + 'Non-judgmental tone — offers to reschedule without requiring an explanation.',
  triggerType: 'no_show',
  triggerConfig: {
    cooldownDays: 21,
    intendedLeadSource: 'Scheduled appointment (any source) that was not kept',
    eligibilityNotes:
      'Trigger within 2 hours of missed appointment window. '
      + 'Do not send if lead showed up late and appointment was marked complete.',
    stopConditions: [
      'Any inbound reply',
      'Appointment rescheduled and marked in CRM',
      'Lead opts out or marked dead',
    ],
    handoffConditions: [
      'Lead replies asking to reschedule',
      'Lead expresses frustration — escalate immediately',
    ],
    requiredMergeFields: ['firstName', 'dealershipName'],
    optionalMergeFields: [],
    maxAttempts: 3,
  },
  steps: [
    {
      type: 'send_sms',
      position: 1,
      config: {
        type: 'send_sms',
        template:
          'Hey {{firstName}}, we had you scheduled at {{dealershipName}} today but missed you — no worries. Everything okay? Still interested in coming in? (Reply STOP to opt out)',
        fallbackTemplate:
          'Hey {{firstName}}, we had you scheduled at {{dealershipName}} today but missed you — no worries. Still interested in coming in? (Reply STOP to opt out)',
        delayHours: 2,
      },
    },
    stopIfReplied(2),
    {
      type: 'send_sms',
      position: 3,
      config: {
        type: 'send_sms',
        template:
          "We'd love to reschedule whenever you're ready — no need to explain. Just reply here and we'll find a time that works.",
        fallbackTemplate:
          "We'd love to reschedule whenever you're ready — no need to explain. Just reply here and we'll find a time.",
        delayHours: 48,
      },
    },
    stopIfReplied(4),
    {
      type: 'send_sms',
      position: 5,
      config: {
        type: 'send_sms',
        template:
          "Last check-in from us, {{firstName}}. If you'd like to come in or just have questions, reply anytime. No pressure.",
        fallbackTemplate:
          "Last check-in from us. If you'd like to come in or have questions, reply anytime. No pressure.",
        delayHours: 96,
      },
    },
  ],
}

// ── Template 4: Unsold Showroom Traffic Revival ────────────────────────────────
// For people who visited the showroom or communicated in-person but did not purchase.
// Fast first touch (4h) — they were just here, context is warm.

const unsoldShowroomRevival: WorkflowTemplate = {
  key: 'unsold_showroom_revival',
  name: 'Unsold Showroom Traffic Revival',
  description:
    'Follows up with walk-in or showroom leads who left without purchasing. '
    + 'Quick first touch while the visit is still fresh, then patience.',
  triggerType: 'stale',
  triggerConfig: {
    daysInactive: 1,
    cooldownDays: 21,
    intendedLeadSource: 'Showroom walk-in, floor up, in-person visit logged in CRM',
    eligibilityNotes:
      'Best triggered same day or next day after showroom visit. '
      + 'Lead source should indicate physical visit. Not for internet-only leads.',
    stopConditions: [
      'Any inbound reply',
      'Lead opts out or marked dead',
      'Lead returns and purchases',
    ],
    handoffConditions: [
      'Lead replies asking about a specific vehicle or price',
      'Lead expresses readiness to buy',
    ],
    requiredMergeFields: ['firstName', 'dealershipName'],
    optionalMergeFields: ['vehicleOfInterest'],
    maxAttempts: 3,
  },
  steps: [
    {
      type: 'send_sms',
      position: 1,
      config: {
        type: 'send_sms',
        template:
          'Hey {{firstName}}, thanks for stopping by {{dealershipName}} today. Did you find what you were looking for, or is there anything we can help with? (Reply STOP to opt out)',
        fallbackTemplate:
          'Hey {{firstName}}, thanks for stopping by {{dealershipName}} today. Did you find what you were looking for, or is there anything we can help with? (Reply STOP to opt out)',
        delayHours: 4,
      },
    },
    stopIfReplied(2),
    {
      type: 'send_sms',
      position: 3,
      config: {
        type: 'send_sms',
        template:
          'Sometimes people need more time — totally get it. If you had questions about the {{vehicleOfInterest}} we didn\'t answer, happy to help over text.',
        fallbackTemplate:
          'Sometimes people need more time — totally get it. If you had questions we didn\'t answer, happy to help over text.',
        delayHours: 72,
      },
    },
    stopIfReplied(4),
    {
      type: 'send_sms',
      position: 5,
      config: {
        type: 'send_sms',
        template:
          "Last message from us, {{firstName}}. If you're still in the market, reply anytime and we'll help you pick up where you left off.",
        fallbackTemplate:
          "Last message from us. If you're still in the market, reply anytime and we'll pick up from here.",
        delayHours: 120,
      },
    },
  ],
}

// ── Template 5: Service-to-Sales Revival ──────────────────────────────────────
// For service-only customers who may be ready to trade or upgrade.
// Tone is relationship-first — they already trust the dealership for service.

const serviceToSalesRevival: WorkflowTemplate = {
  key: 'service_to_sales_revival',
  name: 'Service-to-Sales Revival',
  description:
    'Reaches service-only customers who may be open to upgrading or trading in. '
    + 'Relationship-first tone — they already trust the service department.',
  triggerType: 'manual',
  triggerConfig: {
    cooldownDays: 90,
    intendedLeadSource: 'Service RO customers, loyalty list, manual batch upload',
    eligibilityNotes:
      'Customer must have a service record in the past 12 months. '
      + 'Do not trigger for customers with open service complaints.',
    stopConditions: [
      'Any inbound reply',
      'Customer opts out',
      'Customer purchases or actively declines',
    ],
    handoffConditions: [
      'Customer expresses interest in trading or upgrading',
      'Customer asks about current vehicle value',
    ],
    requiredMergeFields: ['firstName', 'dealershipName'],
    optionalMergeFields: ['vehicleOfInterest'],
    maxAttempts: 3,
  },
  steps: [
    {
      type: 'send_sms',
      position: 1,
      config: {
        type: 'send_sms',
        template:
          'Hey {{firstName}}, thanks for being a {{dealershipName}} service customer. Quick question — have you thought about upgrading your vehicle recently? (Reply STOP to opt out)',
        fallbackTemplate:
          'Hey {{firstName}}, thanks for being a {{dealershipName}} service customer. Quick question — have you thought about upgrading your vehicle recently? (Reply STOP to opt out)',
        delayHours: 0,
      },
    },
    stopIfReplied(2),
    {
      type: 'send_sms',
      position: 3,
      config: {
        type: 'send_sms',
        template:
          "We're seeing strong trade-in values right now. Even if you're not ready, it might be worth a quick conversation. Interested?",
        fallbackTemplate:
          "We're seeing strong trade-in values right now. Even if you're not ready, it might be worth a quick conversation. Interested?",
        delayHours: 96,
      },
    },
    stopIfReplied(4),
    {
      type: 'send_sms',
      position: 5,
      config: {
        type: 'send_sms',
        template:
          "No worries if the timing isn't right, {{firstName}}. Just reply whenever you're ready to explore — we'll make it easy.",
        fallbackTemplate:
          "No worries if the timing isn't right. Just reply whenever you're ready to explore your options — we'll make it easy.",
        delayHours: 168,
      },
    },
  ],
}

// ── Template 6: Orphan Customer Revival ───────────────────────────────────────
// For previous customers whose salesperson has left the dealership.
// Tone is warm and reassuring — the relationship continues.

const orphanCustomerRevival: WorkflowTemplate = {
  key: 'orphan_customer_revival',
  name: 'Orphan Customer Revival',
  description:
    'Re-engages customers whose original salesperson is no longer at the dealership. '
    + 'Warm and reassuring — emphasises continuity of care over individual rep.',
  triggerType: 'orphaned',
  triggerConfig: {
    cooldownDays: 60,
    intendedLeadSource: 'Customers whose assigned salesperson has been deactivated in CRM',
    eligibilityNotes:
      'Original salesperson must no longer be active. '
      + 'Customer must not have been contacted by a new rep in the past 60 days.',
    stopConditions: [
      'Any inbound reply',
      'Customer opts out or marked dead',
      'Customer assigned to new salesperson and contacted',
    ],
    handoffConditions: [
      'Customer replies — assign to available sales rep immediately',
      'Customer expresses any interest or need',
    ],
    requiredMergeFields: ['firstName', 'dealershipName'],
    optionalMergeFields: ['salespersonName'],
    maxAttempts: 3,
  },
  steps: [
    {
      type: 'send_sms',
      position: 1,
      config: {
        type: 'send_sms',
        template:
          'Hey {{firstName}}, this is {{dealershipName}} reaching out. Your previous contact here is no longer with us — we wanted to make sure someone is still looking after you. Anything we can help with? (Reply STOP to opt out)',
        fallbackTemplate:
          'Hey {{firstName}}, this is {{dealershipName}} reaching out. We wanted to make sure someone is still looking after you. Anything we can help with? (Reply STOP to opt out)',
        delayHours: 0,
      },
    },
    stopIfReplied(2),
    {
      type: 'send_sms',
      position: 3,
      config: {
        type: 'send_sms',
        template:
          "We want to make sure you have someone you can count on here at {{dealershipName}}. Whether it's service, a new vehicle, or just a question — we've got you.",
        fallbackTemplate:
          "We want to make sure you have someone here you can count on. Whether it's service, a new vehicle, or just a question — we've got you.",
        delayHours: 72,
      },
    },
    stopIfReplied(4),
    {
      type: 'send_sms',
      position: 5,
      config: {
        type: 'send_sms',
        template:
          "I'll leave it here for now, {{firstName}}. Just know we're here whenever you need us — reply anytime.",
        fallbackTemplate:
          "I'll leave it here for now. Just know we're here whenever you need us — reply anytime.",
        delayHours: 120,
      },
    },
  ],
}

// ── Exported library ───────────────────────────────────────────────────────────

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  internetLeadRevival,
  agedInventoryRevival,
  missedAppointmentRevival,
  unsoldShowroomRevival,
  serviceToSalesRevival,
  orphanCustomerRevival,
]

export const WORKFLOW_TEMPLATE_BY_KEY = Object.fromEntries(
  WORKFLOW_TEMPLATES.map((t) => [t.key, t])
) as Record<string, WorkflowTemplate>
