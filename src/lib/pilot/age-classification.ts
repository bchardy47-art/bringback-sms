/**
 * Lead age classification — Phase 16
 *
 * Pure logic: no DB calls, no side effects.
 * Determines which age bucket a lead falls into based on the dealership's
 * first contact date, and whether the lead is too fresh to reach out to.
 *
 * Rules:
 *   - contactDate is day 1 (dealership's first contact / inquiry date)
 *   - DLR does not reach out before LEAD_HOLD_DAYS (14 days)
 *   - Leads < 14 days old are "held" — stored but not enrolled
 *   - Leads ≥ 14 days are assigned to a bucket (A / B / C / D)
 *   - Leads with no parseable contactDate are flagged as "needs_review"
 */

import {
  LEAD_HOLD_DAYS,
  type AgeBucket,
  type LeadAgeClassification,
} from '@/lib/db/schema'

// ── Legacy tiered alias lists (kept for backwards compat) ─────────────────────
//
// New code should use the source-type-aware lists (INTERNET_DATE_ALIASES etc.)
// via extractCrmDateWithSource(). The PRIMARY/FALLBACK split below preserves
// the old semantics for any external callers.

export const PRIMARY_CONTACT_DATE_ALIASES = [
  'inquirydate',
  'inquiry_date',
  'originalinquiryat',
  'original_inquiry_at',
  'prospectdate',
  'prospect_date',
  'leaddate',
  'lead_date',
  'createddate',
  'created_date',
  'datecreated',
  'date_created',
  'createdat',
  'created_at',
  'created',
  'submitteddate',
  'submitted_date',
  'receiveddate',
  'received_date',
  'firstcontact',
  'first_contact',
  'firstcontactdate',
  'first_contact_date',
  'contactdate',
  'contact_date',
] as const

export const FALLBACK_CONTACT_DATE_ALIASES = [
  'lastactivitydate',
  'last_activity_date',
  'lastactivity',
  'last_activity',
  'lastcontacted',
  'last_contacted',
  'lastcontacteddate',
  'last_contacted_date',
  'datecontacted',
  'date_contacted',
  'date',
] as const

/** Backwards-compat flat list. Prefer extractCrmDateWithSource() for new code. */
export const CONTACT_DATE_ALIASES = [
  ...PRIMARY_CONTACT_DATE_ALIASES,
  ...FALLBACK_CONTACT_DATE_ALIASES,
] as const

// ── Lead source type detection ────────────────────────────────────────────────

export type LeadSourceType = 'internet' | 'lot' | 'unknown'

const LOT_KEYWORDS = [
  'walk-in', 'walkin', 'walk_in', 'showroom', 'lot', 'floor',
  'service', 'service drive', 'phone up', 'phone-up', 'phoneup',
]

const INTERNET_KEYWORDS = [
  'website', 'internet', 'cars.com', 'autotrader', 'cargurus',
  'facebook', 'fb ads', 'ksl', 'chat', 'lead ad', 'google',
  'email', 'web', 'online', 'digital',
]

/**
 * Infer lead source type from a raw CSV row.
 * Checks common source/lead_type/origin fields. Returns 'lot' for showroom /
 * walk-in / service leads, 'internet' for web / portal / social leads,
 * or 'unknown' when the field is absent or unrecognized.
 */
export function detectLeadSourceType(row: Record<string, string>): LeadSourceType {
  const val =
    row['leadSource'] ?? row['lead_source'] ?? row['source'] ?? row['Source'] ??
    row['source_crm'] ?? row['lead_type'] ?? row['leadType'] ??
    row['origin'] ?? row['Origin'] ?? row['Lead Source'] ?? row['Lead Type'] ?? ''
  const s = val.toLowerCase().trim()
  if (!s) return 'unknown'
  for (const kw of LOT_KEYWORDS) {
    if (s.includes(kw)) return 'lot'
  }
  for (const kw of INTERNET_KEYWORDS) {
    if (s.includes(kw)) return 'internet'
  }
  return 'unknown'
}

// ── Source-type-aware date alias lists ────────────────────────────────────────
//
// Three complete priority lists, one per lead source type. Each covers all
// aliases from the legacy PRIMARY/FALLBACK lists plus new CRM-specific variants.
//
// Internet leads: revival timing = most recent customer interaction.
//   last_customer_reply_at wins; inquiry date is last resort.
//
// Lot/showroom leads: revival timing = day of visit.
//   lead_created_at / visit_date win; activity dates are last resort.
//
// Unknown/mixed: same as internet (safe default for unrecognized sources).

export const INTERNET_DATE_ALIASES = [
  // Tier 1: Last customer-initiated interaction
  'last_customer_reply_at', 'lastcustomerreplat',
  'last_customer_reply',    'lastcustomerreply',
  'last_response',          'lastresponse',
  // Tier 2: Last contacted by dealership
  'last_contacted_at',      'lastcontactedat',
  'lastcontacted',          'last_contacted',
  'lastcontacteddate',      'last_contacted_date',
  'datecontacted',          'date_contacted',
  // Tier 3: Last activity (any)
  'lastactivitydate',       'last_activity_date',
  'lastactivityat',         'last_activity_at',
  'lastactivity',           'last_activity',
  // Tier 4: Lead / CRM creation date
  'leadcreatedat',          'lead_created_at',
  'crmcreatedat',           'crm_created_at',
  'dateadded',              'date_added',
  // Tier 5: Explicit original inquiry / form-fill date
  'inquirydate',            'inquiry_date',
  'originalinquiryat',      'original_inquiry_at',
  'prospectdate',           'prospect_date',
  'leaddate',               'lead_date',
  'createddate',            'created_date',
  'datecreated',            'date_created',
  'createdat',              'created_at',
  'created',
  'submitteddate',          'submitted_date',
  'receiveddate',           'received_date',
  'firstcontact',           'first_contact',
  'firstcontactdate',       'first_contact_date',
  'contactdate',            'contact_date',
  'date',
] as const

export const LOT_DATE_ALIASES = [
  // Tier 1: Lead creation = day of visit for lot / showroom leads
  'leadcreatedat',          'lead_created_at',
  // Tier 2: Explicit visit / showroom / appointment date
  'visitdate',              'visit_date',
  'showroomvisitdate',      'showroom_visit_date',
  'appointmentdate',        'appointment_date',
  // Tier 3: Original inquiry / prospect (may also represent visit for lot)
  'inquirydate',            'inquiry_date',
  'originalinquiryat',      'original_inquiry_at',
  'prospectdate',           'prospect_date',
  'leaddate',               'lead_date',
  'firstcontact',           'first_contact',
  'firstcontactdate',       'first_contact_date',
  'contactdate',            'contact_date',
  // Tier 4: CRM / created / submitted
  'createddate',            'created_date',
  'datecreated',            'date_created',
  'createdat',              'created_at',
  'crmcreatedat',           'crm_created_at',
  'created',
  'dateadded',              'date_added',
  'submitteddate',          'submitted_date',
  'receiveddate',           'received_date',
  // Tier 5: Last activity (last resort for lot leads)
  'lastactivitydate',       'last_activity_date',
  'lastactivityat',         'last_activity_at',
  'lastactivity',           'last_activity',
  'lastcontactedat',        'last_contacted_at',
  'lastcontacted',          'last_contacted',
  'lastcontacteddate',      'last_contacted_date',
  'datecontacted',          'date_contacted',
  'last_customer_reply_at', 'lastcustomerreplat',
  'last_customer_reply',    'lastcustomerreply',
  'last_response',          'lastresponse',
  'date',
] as const

export const MIXED_DATE_ALIASES = [
  // Tier 1: Last customer-initiated interaction
  'last_customer_reply_at', 'lastcustomerreplat',
  'last_customer_reply',    'lastcustomerreply',
  'last_response',          'lastresponse',
  // Tier 2: Last contacted
  'last_contacted_at',      'lastcontactedat',
  'lastcontacted',          'last_contacted',
  'lastcontacteddate',      'last_contacted_date',
  'datecontacted',          'date_contacted',
  // Tier 3: Last activity
  'lastactivitydate',       'last_activity_date',
  'lastactivityat',         'last_activity_at',
  'lastactivity',           'last_activity',
  // Tier 4: Lead / CRM creation
  'leadcreatedat',          'lead_created_at',
  'crmcreatedat',           'crm_created_at',
  'dateadded',              'date_added',
  // Tier 5: Original inquiry / form-fill
  'inquirydate',            'inquiry_date',
  'originalinquiryat',      'original_inquiry_at',
  'prospectdate',           'prospect_date',
  'leaddate',               'lead_date',
  'createddate',            'created_date',
  'datecreated',            'date_created',
  'createdat',              'created_at',
  'created',
  'submitteddate',          'submitted_date',
  'receiveddate',           'received_date',
  'firstcontact',           'first_contact',
  'firstcontactdate',       'first_contact_date',
  'contactdate',            'contact_date',
  // Visit dates — lower priority for unknown source
  'visitdate',              'visit_date',
  'showroomvisitdate',      'showroom_visit_date',
  'appointmentdate',        'appointment_date',
  'date',
] as const

/**
 * Dealer-friendly label for non-obvious fallback date sources.
 * Standard primary aliases (inquiry_date, lead_date, created_date, etc.) are
 * NOT in this map — no label is emitted for them. Presence here means DLR
 * derived the revival date from a CRM-secondary / last-activity column and
 * the dealer should know which one was used.
 */
export const DATE_SOURCE_LABELS: Record<string, string> = {
  // Lead / CRM creation
  'lead_created_at':        'Using lead created date',
  'leadcreatedat':          'Using lead created date',
  'crm_created_at':         'Using CRM created date',
  'crmcreatedat':           'Using CRM created date',
  'date_added':             'Using date added',
  'dateadded':              'Using date added',
  // Visit / showroom / appointment
  'visit_date':             'Using visit date',
  'visitdate':              'Using visit date',
  'showroom_visit_date':    'Using showroom visit date',
  'showroomvisitdate':      'Using showroom visit date',
  'appointment_date':       'Using appointment date',
  'appointmentdate':        'Using appointment date',
  // Last customer reply
  'last_customer_reply_at': 'Using last customer reply date',
  'lastcustomerreplat':     'Using last customer reply date',
  'last_customer_reply':    'Using last customer reply date',
  'lastcustomerreply':      'Using last customer reply date',
  'last_response':          'Using last customer reply date',
  'lastresponse':           'Using last customer reply date',
  // Last contacted
  'last_contacted_at':      'Using last contacted date',
  'lastcontactedat':        'Using last contacted date',
  'last_contacted':         'Using last contacted date',
  'lastcontacted':          'Using last contacted date',
  'last_contacted_date':    'Using last contacted date',
  'lastcontacteddate':      'Using last contacted date',
  'date_contacted':         'Using last contacted date',
  'datecontacted':          'Using last contacted date',
  // Last activity
  'last_activity_at':       'Using last activity date',
  'lastactivityat':         'Using last activity date',
  'last_activity':          'Using last activity date',
  'lastactivity':           'Using last activity date',
  'last_activity_date':     'Using last activity date',
  'lastactivitydate':       'Using last activity date',
  // Bare date fallback
  'date':                   'Using date column',
}

// ── Classification result ──────────────────────────────────────────────────────

export type AgeClassificationResult = {
  classification: LeadAgeClassification
  ageBucket:      AgeBucket | null
  leadAgeDays:    number | null
  enrollAfter:    Date | null   // non-null only when classification === 'too_fresh'
  warning:        string | null // informational note for the operator (e.g. staleness)
}

// ── Core classifier ───────────────────────────────────────────────────────────

/**
 * Classify a lead by age given its contact date and today's date.
 *
 * @param contactDate  The dealership's first contact / inquiry date (day 1).
 *                     Pass null if the date is missing or unparseable.
 * @param today        Reference date for age calculation. Defaults to new Date().
 */
export function classifyLeadAge(
  contactDate: Date | null,
  today: Date = new Date(),
): AgeClassificationResult {
  if (!contactDate || isNaN(contactDate.getTime())) {
    return {
      classification: 'needs_review',
      ageBucket:      null,
      leadAgeDays:    null,
      enrollAfter:    null,
      warning:
        'No usable CRM date found — re-import with a recognized date column ' +
        '(e.g. Lead Date, Last Customer Reply, Created At).',
    }
  }

  const MS_PER_DAY = 1000 * 60 * 60 * 24
  const contactMidnight = truncateToDay(contactDate)
  const todayMidnight   = truncateToDay(today)
  const ageDays         = Math.floor((todayMidnight.getTime() - contactMidnight.getTime()) / MS_PER_DAY)

  if (ageDays < 0) {
    return {
      classification: 'needs_review',
      ageBucket:      null,
      leadAgeDays:    ageDays,
      enrollAfter:    null,
      warning:        `Contact date (${contactDate.toISOString().slice(0, 10)}) is in the future. Please correct it.`,
    }
  }

  if (ageDays < LEAD_HOLD_DAYS) {
    const enrollAfter = new Date(contactMidnight.getTime() + LEAD_HOLD_DAYS * MS_PER_DAY)
    return {
      classification: 'too_fresh',
      ageBucket:      null,
      leadAgeDays:    ageDays,
      enrollAfter,
      warning:        null,
    }
  }

  const bucket = ageDaysToBucket(ageDays)

  const warning = ageDays > 3 * 365
    ? `Lead is ${ageDays} days old (over 3 years). DLR will still attempt outreach, but response likelihood is low.`
    : null

  return {
    classification: `bucket_${bucket}` as LeadAgeClassification,
    ageBucket:      bucket,
    leadAgeDays:    ageDays,
    enrollAfter:    null,
    warning,
  }
}

// ── Bucket assignment ─────────────────────────────────────────────────────────

export function ageDaysToBucket(ageDays: number): AgeBucket {
  if (ageDays < 30)  return 'a'
  if (ageDays < 60)  return 'b'
  if (ageDays < 90)  return 'c'
  return 'd'
}

// ── Date parsing from CSV strings ─────────────────────────────────────────────

/**
 * Try to parse a date string from a dealer CSV.
 * Accepts ISO 8601 (2024-03-15 with optional time), US format (03/15/2024),
 * and MM-DD-YYYY. Rejects out-of-range months/days even when `new Date()`
 * would silently overflow them.
 *
 * Returns null if the string is empty or cannot be parsed cleanly.
 */
export function parseContactDate(raw: string | null | undefined): Date | null {
  if (!raw || !raw.trim()) return null

  const s = raw.trim()

  const usSlash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (usSlash) {
    return parseUSDate(usSlash[1], usSlash[2], usSlash[3])
  }

  const usDash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (usDash) {
    return parseUSDate(usDash[1], usDash[2], usDash[3])
  }

  const iso = new Date(s)
  if (!isNaN(iso.getTime())) {
    const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (isoMatch) {
      const [, yy, mm, dd] = isoMatch
      const yNum = Number(yy), mNum = Number(mm), dNum = Number(dd)
      if (mNum < 1 || mNum > 12) return null
      if (dNum < 1 || dNum > 31) return null
      const verify = new Date(Date.UTC(yNum, mNum - 1, dNum))
      if (verify.getUTCMonth() !== mNum - 1 || verify.getUTCDate() !== dNum) {
        return null
      }
      return verify
    }
    return iso
  }

  return null
}

function parseUSDate(monthStr: string, dayStr: string, yearStr: string): Date | null {
  const m = Number(monthStr), d = Number(dayStr), y = Number(yearStr)
  if (m < 1 || m > 12) return null
  if (d < 1 || d > 31) return null
  const candidate = new Date(y, m - 1, d)
  if (isNaN(candidate.getTime())) return null
  if (candidate.getMonth() !== m - 1 || candidate.getDate() !== d) return null
  return candidate
}

/**
 * Given a CSV row object (header-keyed), find and parse the contact date
 * from any recognised column alias. Returns null if no matching column found.
 *
 * Uses the legacy PRIMARY → FALLBACK order. For source-type-aware extraction
 * (recommended for new imports), use extractCrmDateWithSource() instead.
 */
export function extractContactDate(row: Record<string, string>): Date | null {
  return extractContactDateWithSource(row).date
}

/**
 * Same as extractContactDate but also returns the original CSV header and the
 * matched alias (normalized). New code that needs the source label should use
 * extractCrmDateWithSource() which also auto-detects lead source type.
 */
export function extractContactDateWithSource(
  row: Record<string, string>,
  sourceType: LeadSourceType = 'unknown',
): { date: Date | null; source: string | null; matchedAlias: string | null } {
  const lowerKeys = Object.keys(row).reduce<Record<string, string>>((acc, k) => {
    const norm = k.toLowerCase().replace(/[\s-]+/g, '_')
    if (!(norm in acc)) acc[norm] = k
    return acc
  }, {})

  const tryAliases = (
    aliases: readonly string[],
  ): { date: Date; source: string; matchedAlias: string } | null => {
    for (const alias of aliases) {
      const originalKey = lowerKeys[alias]
      if (originalKey !== undefined) {
        const parsed = parseContactDate(row[originalKey])
        if (parsed) return { date: parsed, source: originalKey, matchedAlias: alias }
      }
    }
    return null
  }

  // Source-type-aware priority list
  const priorityAliases =
    sourceType === 'internet' ? INTERNET_DATE_ALIASES :
    sourceType === 'lot'      ? LOT_DATE_ALIASES :
                                MIXED_DATE_ALIASES

  return (
    tryAliases(priorityAliases) ??
    { date: null, source: null, matchedAlias: null }
  )
}

/**
 * Source-type-aware CRM date extraction. Detects the lead source type from
 * the row's source/lead_type fields, applies the appropriate alias priority
 * list, and returns a dealer-friendly label when the matched column is a
 * non-obvious fallback (e.g. last_customer_reply_at instead of inquiry_date).
 *
 * Use this in place of extractContactDate() for all new CSV import paths.
 */
export function extractCrmDateWithSource(row: Record<string, string>): {
  date: Date | null
  source: string | null
  matchedAlias: string | null
  sourceLabel: string | null
} {
  const sourceType  = detectLeadSourceType(row)
  const result      = extractContactDateWithSource(row, sourceType)
  const sourceLabel = result.matchedAlias
    ? (DATE_SOURCE_LABELS[result.matchedAlias] ?? null)
    : null
  return { ...result, sourceLabel }
}

// ── Dealer-facing bucket labels ───────────────────────────────────────────────

export const DEALER_BUCKET_LABEL: Record<AgeBucket, string> = {
  a: '14–30 Day Follow-Up',
  b: '31–60 Day Follow-Up',
  c: '61–90 Day Revival',
  d: '91+ Day Revival',
}

export const DEALER_NEEDS_DATE_LABEL = 'Needs Date'
export const DEALER_HELD_LABEL = 'Held: contacted less than 14 days ago'

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncateToDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
