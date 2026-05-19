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
//
// Two tiers: PRIMARY aliases are tried first (original inquiry / lead /
// created / submitted), FALLBACK aliases are tried only when no primary
// column was present (last-activity / last-contacted / bare "date"). This
// matches the dealer requirement that we prefer the original inquiry date
// over a "last touched" timestamp, which lies about the lead's age.
//
// Aliases are matched case-insensitively against a normalised key
// (lowercased, spaces and dashes → underscores). So a CSV column named
// "Created Date" matches the alias `created_date`.

export const PRIMARY_CONTACT_DATE_ALIASES = [
  // Inquiry-style (the truest "day 1")
  'inquirydate',
  'inquiry_date',
  'originalinquiryat',
  'original_inquiry_at',
  'prospectdate',
  'prospect_date',
  // Lead-style
  'leaddate',
  'lead_date',
  // Created-style
  'createddate',
  'created_date',
  'datecreated',
  'date_created',
  'createdat',
  'created_at',
  'created',
  // Submitted / received
  'submitteddate',
  'submitted_date',
  'receiveddate',
  'received_date',
  // Explicit first-contact synonyms
  'firstcontact',
  'first_contact',
  'firstcontactdate',
  'first_contact_date',
  'contactdate',
  'contact_date',
] as const

export const FALLBACK_CONTACT_DATE_ALIASES = [
  // "Last touched" style — only used when no primary alias is present.
  // These overstate age for old, recently-poked leads, so they're the
  // last resort.
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
  // Bare 'date' — last because it's ambiguous (could mean anything).
  'date',
] as const

/**
 * Backwards-compat re-export. New code should use the tiered constants
 * directly. Order: primary first, fallback last — preserves the previous
 * "first-match-wins" iteration semantics for any external caller.
 */
export const CONTACT_DATE_ALIASES = [
  ...PRIMARY_CONTACT_DATE_ALIASES,
  ...FALLBACK_CONTACT_DATE_ALIASES,
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
      warning:
        'Needs lead date — re-upload with a Lead Date, Created Date, or Inquiry Date column. ' +
        'DLR cannot safely choose a campaign group without a lead date.',
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
 * Accepts ISO 8601 (2024-03-15 with optional time), US format (03/15/2024),
 * and MM-DD-YYYY. Rejects out-of-range months/days even when `new Date()`
 * would silently overflow them.
 *
 * Returns null if the string is empty or cannot be parsed cleanly.
 */
export function parseContactDate(raw: string | null | undefined): Date | null {
  if (!raw || !raw.trim()) return null

  const s = raw.trim()

  // US format: 3/15/2024 or 03/15/2024 (check BEFORE ISO so Node's
  // permissive `new Date('13/15/2024')` parsing can't mask an out-of-range
  // month silently).
  const usSlash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (usSlash) {
    return parseUSDate(usSlash[1], usSlash[2], usSlash[3])
  }

  // MM-DD-YYYY (US-style with dashes instead of slashes)
  const usDash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (usDash) {
    return parseUSDate(usDash[1], usDash[2], usDash[3])
  }

  // ISO 8601: 2024-03-15, 2024-03-15T00:00:00Z, or 2024-03-15 10:00:00.
  // Validate the date components against the parsed output to catch
  // silently-overflowing inputs like "2024-13-45".
  const iso = new Date(s)
  if (!isNaN(iso.getTime())) {
    const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (isoMatch) {
      const [, yy, mm, dd] = isoMatch
      const yNum = Number(yy), mNum = Number(mm), dNum = Number(dd)
      if (mNum < 1 || mNum > 12) return null
      if (dNum < 1 || dNum > 31) return null
      // Re-construct the date and verify no overflow happened
      // (e.g. "2024-02-30" parses to March 1, which is wrong).
      const verify = new Date(Date.UTC(yNum, mNum - 1, dNum))
      if (verify.getUTCMonth() !== mNum - 1 || verify.getUTCDate() !== dNum) {
        return null
      }
      return verify
    }
    // No YYYY-MM-DD prefix — let `new Date()` win (rare formats like
    // "March 15, 2024").
    return iso
  }

  return null
}

/**
 * Helper for parseContactDate's US-format branches. Validates month/day
 * range and rejects overflows so 13/45/2024 doesn't silently become a
 * January-15-2025-style date.
 */
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
 * Tries PRIMARY aliases first (inquiry / lead / created / submitted /
 * received / prospect / first-contact) before falling back to
 * last-activity / last-contacted / bare "date".
 */
export function extractContactDate(row: Record<string, string>): Date | null {
  return extractContactDateWithSource(row).date
}

/**
 * Same as `extractContactDate` but also reports which original CSV header
 * the date came from. `source` is the literal header string as it appeared
 * in the CSV (preserving case + spaces) so it can be shown to the dealer
 * verbatim. Returns `{date: null, source: null}` when nothing matched.
 */
export function extractContactDateWithSource(
  row: Record<string, string>,
): { date: Date | null; source: string | null } {
  const lowerKeys = Object.keys(row).reduce<Record<string, string>>((acc, k) => {
    // Normalise header to lowercase with spaces AND dashes → underscores
    // so "Created Date", "created date", and "created-date" all match the
    // same alias.
    const norm = k.toLowerCase().replace(/[\s-]+/g, '_')
    if (!(norm in acc)) acc[norm] = k
    return acc
  }, {})

  const tryAliases = (aliases: readonly string[]) => {
    for (const alias of aliases) {
      const originalKey = lowerKeys[alias]
      if (originalKey !== undefined) {
        const parsed = parseContactDate(row[originalKey])
        if (parsed) return { date: parsed, source: originalKey }
      }
    }
    return null
  }

  return (
    tryAliases(PRIMARY_CONTACT_DATE_ALIASES) ??
    tryAliases(FALLBACK_CONTACT_DATE_ALIASES) ??
    { date: null, source: null }
  )
}

// ── Dealer-facing bucket labels ───────────────────────────────────────────────
// Presentation-only. The internal `AGE_BUCKET_LABELS` in schema.ts keeps the
// exact day ranges ("14–29 days" etc.); dealers see the slightly rounded
// "14–30 Day Follow-Up" wording in their UI. Boundary leads (day 30 / 60 /
// 90) end up labelled by their internal bucket, which is one day off from
// the rounded label — accepted because changing the day-range boundaries
// would touch the workflow auto-assignment logic.

export const DEALER_BUCKET_LABEL: Record<AgeBucket, string> = {
  a: '14–30 Day Follow-Up',
  b: '31–60 Day Follow-Up',
  c: '61–90 Day Revival',
  d: '91+ Day Revival',
}

/** Dealer-friendly label for a row that hasn't been classified. */
export const DEALER_NEEDS_DATE_LABEL = 'Needs Date'

/** Dealer-friendly label for held (too-fresh) rows. */
export const DEALER_HELD_LABEL = 'Held: contacted less than 14 days ago'

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncateToDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
