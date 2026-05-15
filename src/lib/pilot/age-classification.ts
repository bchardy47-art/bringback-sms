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

// ── Column aliases accepted from dealer CSVs ───────────────────────────────────
// Case-insensitive; first match wins.
export const CONTACT_DATE_ALIASES = [
  'contactdate',
  'contact_date',
  'firstcontact',
  'first_contact',
  'firstcontactdate',
  'first_contact_date',
  'originalinquiryat',
  'original_inquiry_at',
  'inquirydate',
  'inquiry_date',
  'leaddate',
  'lead_date',
  'createdat',
  'created_at',
  'datecontacted',
  'date_contacted',
] as const

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
      warning:        'Contact date is missing or could not be parsed. Enter the date manually to classify this lead.',
    }
  }

  const MS_PER_DAY = 1000 * 60 * 60 * 24
  // Truncate both dates to midnight UTC to get whole-day precision
  const contactMidnight = truncateToDay(contactDate)
  const todayMidnight   = truncateToDay(today)
  const ageDays         = Math.floor((todayMidnight.getTime() - contactMidnight.getTime()) / MS_PER_DAY)

  // Future date — treat as needs_review
  if (ageDays < 0) {
    return {
      classification: 'needs_review',
      ageBucket:      null,
      leadAgeDays:    ageDays,
      enrollAfter:    null,
      warning:        `Contact date (${contactDate.toISOString().slice(0, 10)}) is in the future. Please correct it.`,
    }
  }

  // Too fresh — hold until day 14
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

  // Bucket assignment
  const bucket = ageDaysToBucket(ageDays)

  // Staleness warning (> 3 years) — informational, not a block
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
 * Accepts ISO 8601 (2024-03-15), US format (03/15/2024), and common variants.
 * Returns null if the string is empty or cannot be parsed.
 */
export function parseContactDate(raw: string | null | undefined): Date | null {
  if (!raw || !raw.trim()) return null

  const s = raw.trim()

  // ISO 8601: 2024-03-15 or 2024-03-15T00:00:00Z
  const iso = new Date(s)
  if (!isNaN(iso.getTime())) return iso

  // US format: 3/15/2024 or 03/15/2024
  const usMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (usMatch) {
    const [, m, d, y] = usMatch
    const candidate = new Date(Number(y), Number(m) - 1, Number(d))
    if (!isNaN(candidate.getTime())) return candidate
  }

  // MM-DD-YYYY
  const usMatch2 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (usMatch2) {
    const [, m, d, y] = usMatch2
    const candidate = new Date(Number(y), Number(m) - 1, Number(d))
    if (!isNaN(candidate.getTime())) return candidate
  }

  return null
}

/**
 * Given a CSV row object (header-keyed), find and parse the contact date
 * from any recognised column alias. Returns null if no matching column found.
 */
export function extractContactDate(row: Record<string, string>): Date | null {
  const lowerKeys = Object.keys(row).reduce<Record<string, string>>((acc, k) => {
    acc[k.toLowerCase().replace(/\s+/g, '_')] = k
    return acc
  }, {})

  for (const alias of CONTACT_DATE_ALIASES) {
    const originalKey = lowerKeys[alias]
    if (originalKey !== undefined) {
      const parsed = parseContactDate(row[originalKey])
      if (parsed) return parsed
    }
  }

  return null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncateToDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
