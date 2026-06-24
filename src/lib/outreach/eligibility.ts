/**
 * Outreach eligibility — the hard product rule lives here:
 *
 *   A dealership/prospect must not receive more than ONE marketing/demo invite
 *   within a rolling 30-day window.
 *
 * Eligibility is computed two ways and BOTH must agree before a real send:
 *   1. prospect-state checks (status / email / source / DNC / archived)
 *   2. send-log check — no status='sent' row for this prospect in the last 30d.
 *
 * nextEligibleAt is a cached convenience, NOT the source of truth. send.ts
 * re-queries the send log inside the same request to prevent race/dupe sends.
 */

export const COOLDOWN_DAYS = 30
export const DEFAULT_MAX_BATCH = 25

// Pragmatic email shape check — not RFC-perfect, just rejects obvious garbage.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(email?: string | null): boolean {
  const e = (email ?? '').trim()
  return e.length <= 254 && EMAIL_RE.test(e)
}

export function normalizeEmail(email?: string | null): string {
  return (email ?? '').trim().toLowerCase()
}

export function cooldownStart(now: Date): Date {
  return new Date(now.getTime() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
}

export function nextEligibleFrom(now: Date): Date {
  return new Date(now.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
}

/** Resolve the configured batch ceiling (OUTREACH_MAX_BATCH_SIZE, default 25). */
export function maxBatchSize(): number {
  const raw = process.env.OUTREACH_MAX_BATCH_SIZE
  const n = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BATCH
}

/** Whether real prospect sending is armed. Test sends ignore this. */
export function sendEnabled(): boolean {
  return process.env.OUTREACH_SEND_ENABLED === 'true'
}

// Statuses from which a NEW intro/demo invite may go out.
const SENDABLE_STATUSES = new Set(['new', 'ready', 'sent_intro', 'follow_up'])

export type ProspectForEligibility = {
  id: string
  dealershipName: string | null
  publicEmail: string | null
  sourceUrl: string | null
  status: string
  archivedAt: Date | null
  doNotContactAt: Date | null
  nextEligibleAt: Date | null
}

export type EligibilityResult = {
  eligible: boolean
  /** Stable machine reason — used as outreach_sends.skip_reason. */
  reason:
    | 'eligible'
    | 'archived'
    | 'do_not_contact'
    | 'missing_dealership'
    | 'missing_email'
    | 'invalid_email'
    | 'missing_source'
    | 'status_not_sendable'
    | 'in_cooldown'
  /** Human-readable explanation for the UI. */
  detail: string
}

/**
 * Pure prospect-state eligibility. Pass `sentWithinCooldown=true` when a
 * status='sent' row exists for this prospect inside the 30-day window — the
 * caller looks that up from outreach_sends (the authoritative check).
 */
export function evaluateEligibility(
  p: ProspectForEligibility,
  opts: { now: Date; sentWithinCooldown: boolean },
): EligibilityResult {
  if (p.archivedAt) {
    return { eligible: false, reason: 'archived', detail: 'Prospect is archived.' }
  }
  if (p.doNotContactAt || p.status === 'do_not_contact') {
    return { eligible: false, reason: 'do_not_contact', detail: 'Marked do-not-contact.' }
  }
  if (!(p.dealershipName ?? '').trim()) {
    return { eligible: false, reason: 'missing_dealership', detail: 'No dealership name.' }
  }
  if (!(p.publicEmail ?? '').trim()) {
    return { eligible: false, reason: 'missing_email', detail: 'No public email on file.' }
  }
  if (!isValidEmail(p.publicEmail)) {
    return { eligible: false, reason: 'invalid_email', detail: 'Public email fails validation.' }
  }
  if (!(p.sourceUrl ?? '').trim()) {
    return { eligible: false, reason: 'missing_source', detail: 'No public source URL — required before contacting.' }
  }
  if (!SENDABLE_STATUSES.has(p.status)) {
    return {
      eligible: false,
      reason: 'status_not_sendable',
      detail: `Status "${p.status}" is not sendable. Set back to Ready to re-enable.`,
    }
  }
  if (opts.sentWithinCooldown) {
    return { eligible: false, reason: 'in_cooldown', detail: `Already contacted within ${COOLDOWN_DAYS} days.` }
  }
  if (p.nextEligibleAt && p.nextEligibleAt > opts.now) {
    return { eligible: false, reason: 'in_cooldown', detail: `Cooling down until ${p.nextEligibleAt.toLocaleDateString()}.` }
  }
  return { eligible: true, reason: 'eligible', detail: 'Eligible to send.' }
}
