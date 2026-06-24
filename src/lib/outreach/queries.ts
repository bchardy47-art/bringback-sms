/**
 * Read-side queries for the outreach CRM. No mutations, no sends.
 *
 * Eligibility shown in the LIST/snapshot is the cheap cached version (uses
 * nextEligibleAt, not a per-row send-log scan). The authoritative 30-day
 * send-log check happens in send.ts at send time — the UI count is a guide, the
 * send path is the gate.
 */

import 'server-only'
import { and, count, desc, eq, gte, ilike, inArray, isNotNull, or, max, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dealerProspects, outreachSends, type ProspectStatus } from '@/lib/db/schema'
import {
  evaluateEligibility,
  isValidEmail,
  type EligibilityResult,
} from './eligibility'

type Prospect = typeof dealerProspects.$inferSelect

export const PROSPECT_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  ready: 'Ready to contact',
  sent_intro: 'Sent intro',
  follow_up: 'Follow-up needed',
  replied: 'Replied',
  interested: 'Interested',
  demo_booked: 'Demo booked',
  not_interested: 'Not interested',
  do_not_contact: 'Do not contact',
  bad_email: 'Bad email',
  missing_contact: 'Missing contact',
  archived: 'Archived',
}

export function statusLabel(s: string): string {
  return PROSPECT_STATUS_LABELS[s] ?? s
}

// Tailwind chip classes per status — calm light palette, red reserved for DNC.
export function statusChipClass(s: string): string {
  switch (s) {
    case 'interested':
    case 'demo_booked':
      return 'bg-emerald-100 text-emerald-700'
    case 'replied':
      return 'bg-blue-100 text-blue-700'
    case 'ready':
      return 'bg-amber-100 text-amber-700'
    case 'sent_intro':
    case 'follow_up':
      return 'bg-indigo-100 text-indigo-700'
    case 'do_not_contact':
    case 'bad_email':
      return 'bg-red-100 text-red-700'
    case 'missing_contact':
      return 'bg-orange-100 text-orange-700'
    case 'archived':
      return 'bg-gray-100 text-gray-400'
    default:
      return 'bg-gray-100 text-gray-600'
  }
}

// ── Dashboard stats ──────────────────────────────────────────────────────────

export type OutreachStats = {
  readyToSend: number
  contactedLast30: number
  repliesInterested: number
  demoBooked: number
  doNotContact: number
  missingEmailOrSource: number
  sentThisMonth: number
  lastSendAt: Date | null
}

export async function getOutreachStats(now = new Date()): Promise<OutreachStats> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  // Pull a lean projection of every non-archived prospect and tabulate in JS.
  // The prospect table is small (admin-curated), so this is cheaper to read
  // than several conditional aggregates and keeps the eligibility logic shared.
  const rows = await db
    .select({
      status: dealerProspects.status,
      publicEmail: dealerProspects.publicEmail,
      sourceUrl: dealerProspects.sourceUrl,
      archivedAt: dealerProspects.archivedAt,
      doNotContactAt: dealerProspects.doNotContactAt,
      dealershipName: dealerProspects.dealershipName,
      nextEligibleAt: dealerProspects.nextEligibleAt,
      lastContactedAt: dealerProspects.lastContactedAt,
    })
    .from(dealerProspects)

  let readyToSend = 0
  let contactedLast30 = 0
  let repliesInterested = 0
  let demoBooked = 0
  let doNotContact = 0
  let missingEmailOrSource = 0

  for (const r of rows) {
    if (r.doNotContactAt || r.status === 'do_not_contact') doNotContact++
    if (r.status === 'replied' || r.status === 'interested') repliesInterested++
    if (r.status === 'demo_booked') demoBooked++
    if (r.lastContactedAt && r.lastContactedAt >= since30) contactedLast30++

    const archived = !!r.archivedAt || r.status === 'archived'
    if (!archived && !r.doNotContactAt && r.status !== 'do_not_contact') {
      const hasEmail = !!(r.publicEmail ?? '').trim() && isValidEmail(r.publicEmail)
      const hasSource = !!(r.sourceUrl ?? '').trim()
      if (!hasEmail || !hasSource) missingEmailOrSource++

      const elig = evaluateEligibility(
        { id: '', dealershipName: r.dealershipName, publicEmail: r.publicEmail, sourceUrl: r.sourceUrl, status: r.status, archivedAt: r.archivedAt, doNotContactAt: r.doNotContactAt, nextEligibleAt: r.nextEligibleAt },
        { now, sentWithinCooldown: false },
      )
      if (elig.eligible) readyToSend++
    }
  }

  const [sentMonthRow, lastSendRow] = await Promise.all([
    db.select({ n: count() }).from(outreachSends).where(and(eq(outreachSends.status, 'sent'), gte(outreachSends.createdAt, monthStart))),
    db.select({ v: max(outreachSends.createdAt) }).from(outreachSends).where(eq(outreachSends.status, 'sent')),
  ])

  return {
    readyToSend,
    contactedLast30,
    repliesInterested,
    demoBooked,
    doNotContact,
    missingEmailOrSource,
    sentThisMonth: sentMonthRow[0]?.n ?? 0,
    lastSendAt: lastSendRow[0]?.v ?? null,
  }
}

// ── Prospect list (with filters) ─────────────────────────────────────────────

export type ProspectFilters = {
  status?: string
  priority?: string
  q?: string
  limit?: number
}

export type ProspectRow = Prospect & { eligibility: EligibilityResult }

export async function listProspects(filters: ProspectFilters = {}, now = new Date()): Promise<ProspectRow[]> {
  const conds: SQL[] = []
  if (filters.status && filters.status !== 'all') {
    if (filters.status === 'active') {
      // everything except archived
      conds.push(inArray(dealerProspects.status, [
        'new', 'ready', 'sent_intro', 'follow_up', 'replied', 'interested',
        'demo_booked', 'not_interested', 'do_not_contact', 'bad_email', 'missing_contact',
      ] as ProspectStatus[]))
    } else {
      conds.push(eq(dealerProspects.status, filters.status as ProspectStatus))
    }
  }
  if (filters.priority && filters.priority !== 'all') {
    conds.push(eq(dealerProspects.priority, filters.priority))
  }
  if (filters.q) {
    const like = `%${filters.q}%`
    conds.push(
      or(
        ilike(dealerProspects.dealershipName, like),
        ilike(dealerProspects.publicEmail, like),
        ilike(dealerProspects.city, like),
      ) as SQL,
    )
  }

  const rows = await db
    .select()
    .from(dealerProspects)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(dealerProspects.createdAt))
    .limit(filters.limit ?? 500)

  return rows.map(p => ({
    ...p,
    eligibility: evaluateEligibility(
      { id: p.id, dealershipName: p.dealershipName, publicEmail: p.publicEmail, sourceUrl: p.sourceUrl, status: p.status, archivedAt: p.archivedAt, doNotContactAt: p.doNotContactAt, nextEligibleAt: p.nextEligibleAt },
      { now, sentWithinCooldown: false },
    ),
  }))
}

export async function getProspect(id: string): Promise<Prospect | null> {
  const rows = await db.select().from(dealerProspects).where(eq(dealerProspects.id, id)).limit(1)
  return rows[0] ?? null
}

// Distinct priorities present, for filter chips
export async function distinctPriorities(): Promise<string[]> {
  const rows = await db.selectDistinct({ v: dealerProspects.priority }).from(dealerProspects)
  return rows.map(r => r.v).filter(Boolean).sort()
}

// silence unused import noise for helpers referenced only in type position
void isNotNull
