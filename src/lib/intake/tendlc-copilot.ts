/**
 * 10DLC Submission Copilot — pure audit + packet builders.
 *
 * Inputs: an intake row + (optional) tenant row.
 * Outputs:
 *   - auditIntake() → readiness verdict, hard checks, soft risk flags
 *   - buildPacketSections() → named copy-ready text blocks
 *   - buildFullPacket() → all sections concatenated for one-click copy
 *
 * No DB calls. No mutations. Safe to call from a server component on
 * every request. The copilot never talks to Telnyx or any carrier API —
 * the human operator still opens the Telnyx portal, pastes the packet,
 * reviews, pays the fee, and submits. Only after that do they come back
 * to DLR and click the existing "Mark as submitted" action.
 */

import type { InferSelectModel } from 'drizzle-orm'
import type { dealerIntakes, tenants } from '@/lib/db/schema'

type DealerIntake = InferSelectModel<typeof dealerIntakes>
type Tenant       = InferSelectModel<typeof tenants>

// ── Audit output ──────────────────────────────────────────────────────────────

export type AuditCheck = {
  key:    string
  label:  string
  passed: boolean
  detail: string
}

export type AuditRisk = {
  key:    string
  label:  string
  detail: string
}

export type Readiness = 'ready' | 'high_risk' | 'needs_fixes'

export type IntakeAudit = {
  readiness:  Readiness
  checks:     AuditCheck[]
  risks:      AuditRisk[]
  summary:    string
}

// ── Packet output ─────────────────────────────────────────────────────────────

export type PacketSections = {
  brand:        string
  contacts:     string
  campaign:     string
  leadSource:   string
  consent:      string
  sample1:      string
  sample2:      string
  optOut:       string
  internal:     string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function has(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

function fmt(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—'
  return String(v)
}

const VAGUE_LEAD_SOURCE_PHRASES = [
  'various',  'all kinds', 'many sources', 'multiple sources',
  'whatever', 'wherever',  'misc',         'other',
]

const COLD_MARKETING_TERMS = [
  '% off',    'discount', 'sale',         'limited time', 'limited-time',
  'promo',    'promotion','blast',        'deal of the',  'lowest price',
  'huge savings',         'best deal',    'last chance',  'one day only',
]

function looksVague(text: string): boolean {
  const lower = text.toLowerCase()
  return VAGUE_LEAD_SOURCE_PHRASES.some(p => lower.includes(p))
}

function looksColdMarketing(text: string): boolean {
  const lower = text.toLowerCase()
  return COLD_MARKETING_TERMS.some(p => lower.includes(p))
}

function containsOptOutLanguage(text: string | null | undefined): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  return lower.includes('stop') || lower.includes('opt out') || lower.includes('opt-out')
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export function auditIntake(intake: DealerIntake, tenant: Tenant | null): IntakeAudit {
  const checks: AuditCheck[] = []
  const risks:  AuditRisk[]  = []

  // ── Hard checks ────────────────────────────────────────────────────────────
  checks.push({
    key:    'legal_name',
    label:  'Legal business name',
    passed: has(intake.businessLegalName),
    detail: has(intake.businessLegalName)
      ? `"${intake.businessLegalName}"`
      : 'Required for TCR brand registration. Set businessLegalName on the intake.',
  })

  checks.push({
    key:    'ein',
    label:  'EIN',
    passed: has(intake.ein),
    detail: has(intake.ein)
      ? `${intake.ein}`
      : 'Required for TCR brand registration. Federal Tax ID — capture from the dealer.',
  })

  checks.push({
    key:    'website',
    label:  'Business website',
    passed: has(intake.businessWebsite),
    detail: has(intake.businessWebsite)
      ? `${intake.businessWebsite}`
      : 'Required by most carriers. A live dealership site builds trust during vetting.',
  })

  checks.push({
    key:    'address',
    label:  'Business address',
    passed: has(intake.businessAddress),
    detail: has(intake.businessAddress)
      ? `${intake.businessAddress}`
      : 'Required for TCR brand registration. Use the dealership’s physical address.',
  })

  const contactOk = has(intake.primaryContactName) &&
                    has(intake.primaryContactEmail) &&
                    (has(intake.primaryContactPhone) || has(intake.alertPhone))
  checks.push({
    key:    'contact',
    label:  'Primary contact (name + email + phone)',
    passed: contactOk,
    detail: contactOk
      ? `${intake.primaryContactName} · ${intake.primaryContactEmail}`
      : 'Need a name, email, and at least one phone number for the responsible operator.',
  })

  const leadSourceLen = (intake.leadSourceExplanation ?? '').trim().length
  checks.push({
    key:    'lead_source',
    label:  'Lead source explanation',
    passed: leadSourceLen >= 30,
    detail: leadSourceLen >= 30
      ? `${leadSourceLen} characters captured.`
      : 'Carriers require a clear explanation of where leads come from. Aim for 2–3 sentences.',
  })

  const consentLen = (intake.consentExplanation ?? '').trim().length
  checks.push({
    key:    'consent',
    label:  'Consent / opt-in explanation',
    passed: consentLen >= 30,
    detail: consentLen >= 30
      ? `${consentLen} characters captured.`
      : 'Carriers reject submissions without a clear consent narrative. Reference how the dealer captured prior consent.',
  })

  const messagingPlanOk =
    has(intake.sampleMessage1) ||
    has(intake.sampleMessage2) ||
    has(intake.dealerMessagingNotes) ||
    intake.submittedAt != null
  checks.push({
    key:    'messaging_plan',
    label:  'Messaging plan',
    passed: messagingPlanOk,
    detail: messagingPlanOk
      ? 'Dealer kept defaults or provided custom copy.'
      : 'Dealer has not confirmed messaging copy. Either approve defaults or capture custom samples.',
  })

  const notAlreadySubmitted =
    intake.launchStatus === 'submitted' || intake.launchStatus === 'info_complete'
  checks.push({
    key:    'not_already_submitted',
    label:  'Not already submitted',
    passed: notAlreadySubmitted,
    detail: notAlreadySubmitted
      ? 'Intake is still pre-submission.'
      : `Launch status is "${intake.launchStatus}" — this brand/campaign has already been submitted. Use the existing TCR reference instead of re-submitting.`,
  })

  const notLive =
    tenant?.tenDlcStatus !== 'approved' && intake.launchStatus !== 'live'
  checks.push({
    key:    'not_live',
    label:  'Tenant not already live',
    passed: notLive,
    detail: notLive
      ? 'Tenant is not yet live for 10DLC sends.'
      : 'Tenant is already approved and live. No re-submission needed.',
  })

  // ── Risk flags (soft) ──────────────────────────────────────────────────────
  if (!has(intake.businessWebsite)) {
    risks.push({
      key:    'missing_website',
      label:  'No website on file',
      detail: 'Carriers heavily penalise brand submissions without a live website.',
    })
  }

  if (!has(intake.ein)) {
    risks.push({
      key:    'missing_ein',
      label:  'No EIN on file',
      detail: 'EIN-less submissions are routinely rejected by TCR.',
    })
  }

  if (!has(intake.businessAddress)) {
    risks.push({
      key:    'missing_address',
      label:  'No business address on file',
      detail: 'TCR brand registration requires a physical address.',
    })
  }

  if (has(intake.businessLegalName) && (intake.businessLegalName?.trim().length ?? 0) < 5) {
    risks.push({
      key:    'short_legal_name',
      label:  'Legal name looks suspiciously short',
      detail: `"${intake.businessLegalName}" — verify this matches the IRS-registered entity name.`,
    })
  }

  if (leadSourceLen > 0 && leadSourceLen < 80) {
    risks.push({
      key:    'vague_lead_source',
      label:  'Lead source explanation is short',
      detail: 'Aim for at least 2–3 sentences. Brief explanations get flagged.',
    })
  } else if (has(intake.leadSourceExplanation) && looksVague(intake.leadSourceExplanation!)) {
    risks.push({
      key:    'vague_lead_source',
      label:  'Lead source explanation uses generic language',
      detail: 'Phrases like "various sources" trigger carrier scrutiny. Be specific about how the dealership acquired these leads.',
    })
  }

  if (consentLen > 0 && consentLen < 80) {
    risks.push({
      key:    'vague_consent',
      label:  'Consent explanation is short',
      detail: 'Carriers want explicit reference to how consent was captured — web form, in-store, sales contact, etc.',
    })
  }

  const hasOptOut =
    containsOptOutLanguage(intake.sampleMessage1) ||
    containsOptOutLanguage(intake.sampleMessage2) ||
    containsOptOutLanguage(intake.consentExplanation) ||
    containsOptOutLanguage(intake.dealerMessagingNotes)
  if (
    (has(intake.sampleMessage1) || has(intake.sampleMessage2)) &&
    !hasOptOut
  ) {
    risks.push({
      key:    'no_optout_language',
      label:  'No STOP/opt-out language found',
      detail: 'Submission packet includes the standard CTIA "Reply STOP" footer, but the dealer-supplied samples lack it. Carriers may flag inconsistency.',
    })
  }

  const allSamples = [intake.sampleMessage1, intake.sampleMessage2]
    .filter(has)
    .join(' ')
  if (allSamples && looksColdMarketing(allSamples)) {
    risks.push({
      key:    'cold_marketing_tone',
      label:  'Sample copy reads like cold marketing',
      detail: 'TCR rejects "promotional blast" campaigns. Re-engagement copy should reference the prior customer relationship, not push discounts.',
    })
  }

  // ── Verdict ────────────────────────────────────────────────────────────────
  const failedChecks = checks.filter(c => !c.passed)

  let readiness: Readiness
  let summary:   string

  if (failedChecks.length > 0) {
    readiness = 'needs_fixes'
    summary = `${failedChecks.length} required field${failedChecks.length === 1 ? '' : 's'} missing or invalid. Fix before submitting.`
  } else if (risks.length >= 2) {
    readiness = 'high_risk'
    summary = `All required fields present, but ${risks.length} carrier-rejection risks detected. Review risks before submitting.`
  } else {
    readiness = 'ready'
    summary = risks.length === 1
      ? 'Ready for human review. One minor risk flagged — review before submitting.'
      : 'Ready for human review. Operator can paste packet into Telnyx and submit.'
  }

  return { readiness, checks, risks, summary }
}

// ── Packet builders ───────────────────────────────────────────────────────────

export function buildPacketSections(
  intake: DealerIntake,
  tenant: Tenant | null,
): PacketSections {
  const brand = [
    `Legal Name: ${fmt(intake.businessLegalName)}`,
    `EIN: ${fmt(intake.ein)}`,
    `Website: ${fmt(intake.businessWebsite)}`,
    `Business Address: ${fmt(intake.businessAddress)}`,
    `Approved Sender Name (rooftop): ${fmt(intake.dealershipName)}`,
  ].join('\n')

  const contacts = [
    `Primary Contact Name: ${fmt(intake.primaryContactName)}`,
    `Primary Contact Email: ${fmt(intake.primaryContactEmail)}`,
    `Primary Contact Phone: ${fmt(intake.primaryContactPhone ?? intake.alertPhone)}`,
    intake.alertEmail ? `Alert Email: ${intake.alertEmail}` : null,
    intake.alertPhone && intake.alertPhone !== intake.primaryContactPhone ? `Manager Mobile: ${intake.alertPhone}` : null,
    intake.storePhone ? `Store Phone: ${intake.storePhone}` : null,
  ].filter(Boolean).join('\n')

  const campaign =
    'Use case: SMS re-engagement of inactive prior leads — customers and prospects ' +
    'who previously contacted the dealership through the dealer\'s own CRM and went ' +
    'silent. Messages are personalised follow-ups from the original sales context, ' +
    'not promotional blasts. Sends only happen during business hours, respect STOP, ' +
    'and stop after a single human reply.'

  const leadSource = intake.leadSourceExplanation?.trim()
    ? intake.leadSourceExplanation.trim()
    : '(no lead source explanation captured)'

  const consent = intake.consentExplanation?.trim()
    ? intake.consentExplanation.trim()
    : '(no consent explanation captured)'

  const sample1 = intake.sampleMessage1?.trim()
    || '(no sample message provided — using workflow template default)'

  const sample2 = intake.sampleMessage2?.trim()
    || '(no second sample provided)'

  const optOut = 'All messages include the standard CTIA opt-out footer: ' +
                 '"Reply STOP to opt out, HELP for help." STOP is honoured immediately and ' +
                 'recorded in the tenant opt-out table; subsequent sends are blocked at the ' +
                 'platform level regardless of campaign state.'

  const internal = [
    `Approved Sender Name: ${fmt(intake.dealershipName)}`,
    `Expected Monthly Volume: ${fmt(intake.expectedMonthlyVolume)}`,
    `DLR Intake ID: ${intake.id}`,
    `DLR Tenant ID: ${fmt(intake.tenantId)}`,
    tenant?.tenDlcStatus ? `Tenant 10DLC status: ${tenant.tenDlcStatus}` : null,
    intake.tenDlcReference ? `Existing TCR reference: ${intake.tenDlcReference}` : null,
  ].filter(Boolean).join('\n')

  return { brand, contacts, campaign, leadSource, consent, sample1, sample2, optOut, internal }
}

export function buildFullPacket(sections: PacketSections): string {
  return [
    '=== Business / Brand info ===',
    sections.brand,
    '',
    '=== Contact info ===',
    sections.contacts,
    '',
    '=== Campaign use case ===',
    sections.campaign,
    '',
    '=== Lead source explanation ===',
    sections.leadSource,
    '',
    '=== Consent / opt-in explanation ===',
    sections.consent,
    '',
    '=== Sample message 1 ===',
    sections.sample1,
    '',
    '=== Sample message 2 ===',
    sections.sample2,
    '',
    '=== Opt-out language ===',
    sections.optOut,
    '',
    '=== Internal notes ===',
    sections.internal,
  ].join('\n')
}

/** Campaign narrative subset — use-case + lead source + consent. */
export function buildCampaignNarrative(sections: PacketSections): string {
  return [
    '=== Campaign use case ===',
    sections.campaign,
    '',
    '=== Lead source explanation ===',
    sections.leadSource,
    '',
    '=== Consent / opt-in explanation ===',
    sections.consent,
  ].join('\n')
}

/** Sample messages subset — sample1 + sample2 + opt-out footer. */
export function buildSampleMessagesBlock(sections: PacketSections): string {
  return [
    '=== Sample message 1 ===',
    sections.sample1,
    '',
    '=== Sample message 2 ===',
    sections.sample2,
    '',
    '=== Opt-out language ===',
    sections.optOut,
  ].join('\n')
}
