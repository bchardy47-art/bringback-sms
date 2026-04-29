/**
 * Phase 12 — 10DLC Sample Message Library
 *
 * Provides compliant sample messages for TCR 10DLC campaign submission.
 * Each sample is derived from the six production workflow templates and
 * meets all CTIA / TCR requirements:
 *
 *   - Sender identity included (dealership name)
 *   - Purpose is clear and non-deceptive
 *   - No fake urgency or misleading claims
 *   - Opt-out language present where required (first message in a sequence)
 *   - Representative of actual messages that will be sent
 *
 * Usage:
 *   - Call getSampleMessages() to get all samples (for TCR submission display)
 *   - Call renderSample(sample, vars) to fill in merge fields with real values
 *   - Call generateTcrSampleSet(count) to get the minimum required set for submission
 *
 * TCR requires at least 2 sample messages per campaign. We generate 6
 * (one per workflow type) to demonstrate the full range of use cases.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type SampleMessageCategory =
  | 'internet_lead_revival'
  | 'aged_inventory_revival'
  | 'missed_appointment_revival'
  | 'unsold_showroom_revival'
  | 'service_to_sales_revival'
  | 'orphan_customer_revival'

export type SampleMessage = {
  /** Unique ID for this sample */
  id: string
  /** Which workflow template this comes from */
  category: SampleMessageCategory
  /** Human-readable label for the UI */
  label: string
  /** The sample message body with {{placeholder}} merge fields filled with example values */
  rendered: string
  /** The raw template with {{placeholder}} merge fields */
  template: string
  /** Whether this sample includes opt-out language */
  hasOptOut: boolean
  /** The step position within the workflow this represents (1, 3, or 5) */
  stepPosition: 1 | 3 | 5
  /** Brief explanation of the send context (shown in TCR submission) */
  context: string
}

export type SampleRenderVars = {
  firstName?: string
  dealershipName?: string
  vehicleOfInterest?: string
  salespersonName?: string
}

// ── Default example values (used when rendering for display) ─────────────────

const EXAMPLE_VARS: Required<SampleRenderVars> = {
  firstName: 'Alex',
  dealershipName: 'Riverside Auto Group',
  vehicleOfInterest: '2022 Honda CR-V',
  salespersonName: 'Marcus',
}

// ── Sample message definitions ────────────────────────────────────────────────
//
// Drawn directly from the production workflow templates in src/lib/workflows/templates.ts.
// Each sample uses the fallbackTemplate where applicable so the message stands
// alone without requiring vehicleOfInterest to be present.

const SAMPLE_MESSAGES: SampleMessage[] = [

  // ── Template 1: Old Internet Lead Revival ──────────────────────────────────

  {
    id: 'internet_revival_step1',
    category: 'internet_lead_revival',
    label: 'Internet Lead Revival — Initial Outreach',
    template:
      'Hey {{firstName}}, this is {{dealershipName}}. You reached out a while back about a vehicle — are you still in the market, or did you already find something? (Reply STOP to opt out)',
    rendered:
      'Hey Alex, this is Riverside Auto Group. You reached out a while back about a vehicle — are you still in the market, or did you already find something? (Reply STOP to opt out)',
    hasOptOut: true,
    stepPosition: 1,
    context:
      'Sent to leads who submitted an internet inquiry (web form, third-party listing site) and have not responded in 7+ days. First message in a 3-touch automated sequence.',
  },

  {
    id: 'internet_revival_step3',
    category: 'internet_lead_revival',
    label: 'Internet Lead Revival — Follow-Up',
    template:
      'No pressure at all — just wanted to follow up. Still in the market, or has your situation changed?',
    rendered:
      'No pressure at all — just wanted to follow up. Still in the market, or has your situation changed?',
    hasOptOut: false,
    stepPosition: 3,
    context:
      'Sent 72 hours after the first message if no reply has been received. Sequence stops immediately upon any reply.',
  },

  // ── Template 2: Aged Inventory Inquiry Revival ─────────────────────────────

  {
    id: 'aged_inventory_step1',
    category: 'aged_inventory_revival',
    label: 'Aged Inventory Revival — Initial Outreach',
    template:
      'Hey {{firstName}}, following up from {{dealershipName}} — you reached out about a vehicle a little while back. Still interested, or did you go a different direction? (Reply STOP to opt out)',
    rendered:
      'Hey Alex, following up from Riverside Auto Group — you reached out about a vehicle a little while back. Still interested, or did you go a different direction? (Reply STOP to opt out)',
    hasOptOut: true,
    stepPosition: 1,
    context:
      'Sent to leads who inquired about a specific vehicle (detail page, phone-up) 14+ days ago with no further contact. First message in a 3-touch automated sequence.',
  },

  {
    id: 'aged_inventory_step3',
    category: 'aged_inventory_revival',
    label: 'Aged Inventory Revival — Inventory Check Offer',
    template:
      "We still have some good options available if the timing is better now. Want me to check what we have?",
    rendered:
      "We still have some good options available if the timing is better now. Want me to check what we have?",
    hasOptOut: false,
    stepPosition: 3,
    context:
      'Sent 96 hours after the first message if no reply received. Offers to check inventory without pressure.',
  },

  // ── Template 3: Missed Appointment / No-Show ───────────────────────────────

  {
    id: 'missed_appt_step1',
    category: 'missed_appointment_revival',
    label: 'Missed Appointment — Initial Check-In',
    template:
      'Hey {{firstName}}, we had you scheduled at {{dealershipName}} today but missed you — no worries. Still interested in coming in? (Reply STOP to opt out)',
    rendered:
      'Hey Alex, we had you scheduled at Riverside Auto Group today but missed you — no worries. Still interested in coming in? (Reply STOP to opt out)',
    hasOptOut: true,
    stepPosition: 1,
    context:
      'Sent 2 hours after a scheduled appointment window that was not kept. Non-judgmental tone — offers to reschedule without requiring explanation.',
  },

  {
    id: 'missed_appt_step3',
    category: 'missed_appointment_revival',
    label: 'Missed Appointment — Reschedule Offer',
    template:
      "We'd love to reschedule whenever you're ready — no need to explain. Just reply here and we'll find a time that works.",
    rendered:
      "We'd love to reschedule whenever you're ready — no need to explain. Just reply here and we'll find a time that works.",
    hasOptOut: false,
    stepPosition: 3,
    context:
      'Sent 48 hours after the initial check-in if no reply received.',
  },

  // ── Template 4: Unsold Showroom Traffic ────────────────────────────────────

  {
    id: 'showroom_step1',
    category: 'unsold_showroom_revival',
    label: 'Showroom Visit — Day-Of Follow-Up',
    template:
      'Hey {{firstName}}, thanks for stopping by {{dealershipName}} today. Did you find what you were looking for, or is there anything we can help with? (Reply STOP to opt out)',
    rendered:
      'Hey Alex, thanks for stopping by Riverside Auto Group today. Did you find what you were looking for, or is there anything we can help with? (Reply STOP to opt out)',
    hasOptOut: true,
    stepPosition: 1,
    context:
      'Sent 4 hours after a showroom walk-in that did not result in a purchase. Warm context — the customer was just on-site.',
  },

  // ── Template 5: Service-to-Sales ──────────────────────────────────────────

  {
    id: 'service_to_sales_step1',
    category: 'service_to_sales_revival',
    label: 'Service Customer — Upgrade Check-In',
    template:
      'Hey {{firstName}}, thanks for being a {{dealershipName}} service customer. Quick question — have you thought about upgrading your vehicle recently? (Reply STOP to opt out)',
    rendered:
      'Hey Alex, thanks for being a Riverside Auto Group service customer. Quick question — have you thought about upgrading your vehicle recently? (Reply STOP to opt out)',
    hasOptOut: true,
    stepPosition: 1,
    context:
      'Sent to existing service customers who have had a repair order in the past 12 months and have not been contacted about a vehicle purchase. Relationship-first tone.',
  },

  {
    id: 'service_to_sales_step3',
    category: 'service_to_sales_revival',
    label: 'Service Customer — Trade-In Value Mention',
    template:
      "We're seeing strong trade-in values right now. Even if you're not ready, it might be worth a quick conversation. Interested?",
    rendered:
      "We're seeing strong trade-in values right now. Even if you're not ready, it might be worth a quick conversation. Interested?",
    hasOptOut: false,
    stepPosition: 3,
    context:
      'Sent 96 hours after the initial message if no reply received. Factual, no pressure — invites a conversation rather than making a hard offer.',
  },

  // ── Template 6: Orphan Customer Revival ───────────────────────────────────

  {
    id: 'orphan_step1',
    category: 'orphan_customer_revival',
    label: 'Orphan Customer — Continuity Message',
    template:
      'Hey {{firstName}}, this is {{dealershipName}} reaching out. We wanted to make sure someone is still looking after you. Anything we can help with? (Reply STOP to opt out)',
    rendered:
      'Hey Alex, this is Riverside Auto Group reaching out. We wanted to make sure someone is still looking after you. Anything we can help with? (Reply STOP to opt out)',
    hasOptOut: true,
    stepPosition: 1,
    context:
      'Sent to customers whose assigned salesperson is no longer with the dealership. Warm and reassuring — focuses on continuity of service, not a sales pitch.',
  },

  {
    id: 'orphan_step3',
    category: 'orphan_customer_revival',
    label: 'Orphan Customer — Support Offer',
    template:
      "We want to make sure you have someone you can count on here at {{dealershipName}}. Whether it's service, a new vehicle, or just a question — we've got you.",
    rendered:
      "We want to make sure you have someone you can count on here at Riverside Auto Group. Whether it's service, a new vehicle, or just a question — we've got you.",
    hasOptOut: false,
    stepPosition: 3,
    context:
      'Sent 72 hours after the initial message if no reply received.',
  },
]

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns all sample messages.
 */
export function getSampleMessages(): SampleMessage[] {
  return SAMPLE_MESSAGES
}

/**
 * Returns sample messages for a specific workflow category.
 */
export function getSamplesByCategory(category: SampleMessageCategory): SampleMessage[] {
  return SAMPLE_MESSAGES.filter(s => s.category === category)
}

/**
 * Returns the minimum set required for a TCR campaign submission.
 * TCR requires at least 2 samples — we return one first-step sample from each
 * of the primary revenue-generating templates.
 *
 * @param count - Number of samples to return (minimum 2, default 4)
 */
export function generateTcrSampleSet(count: number = 4): SampleMessage[] {
  // Prefer step-1 messages (they always include opt-out language and sender ID)
  const step1 = SAMPLE_MESSAGES.filter(s => s.stepPosition === 1)
  return step1.slice(0, Math.max(2, Math.min(count, step1.length)))
}

/**
 * Render a sample message template with custom variables.
 * Falls back to the EXAMPLE_VARS for any missing variable.
 */
export function renderSample(
  sample: SampleMessage,
  vars: SampleRenderVars = {}
): string {
  const merged = { ...EXAMPLE_VARS, ...vars }
  return sample.template.replace(
    /\{\{(\w+)\}\}/g,
    (_, key: string) => merged[key as keyof SampleRenderVars] ?? ''
  )
}

/**
 * Returns the rendered message bodies suitable for copy-pasting into a TCR
 * campaign submission form.
 *
 * @param vars - Optional dealership-specific values to substitute
 * @param count - Number of samples to include (default 4)
 */
export function getTcrSubmissionText(
  vars: SampleRenderVars = {},
  count: number = 4
): string[] {
  return generateTcrSampleSet(count).map(s => renderSample(s, vars))
}
