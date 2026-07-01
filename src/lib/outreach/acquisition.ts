/**
 * Dealer Acquisition Command Center — read model + label helpers (V1).
 *
 * Reuses the existing `dealer_prospects` table (no separate CRM). The
 * `pipeline_status` column is the acquisition funnel dimension, distinct from
 * `status` (which drives outreach send eligibility). Server-only.
 */
import 'server-only'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dealerProspects, pipelineStageValues, type PipelineStage } from '@/lib/db/schema'

export const GOAL_PAID_DEALERS = 20

export const PIPELINE_LABELS: Record<PipelineStage, string> = {
  prospect_found:       'Prospect Found',
  decision_maker_found: 'Decision Maker Found',
  email_1_sent:         'Email 1 Sent',
  call_attempted:       'Call Attempted',
  follow_up_sent:       'Follow-Up Sent',
  interested:           'Interested',
  pilot_offered:        'Pilot Offered',
  pilot_active:         'Pilot Active',
  results_sent:         'Results Sent',
  paid:                 'Paid',
  lost:                 'Lost',
  follow_up_later:      'Follow Up Later',
}

export function pipelineLabel(s: string): string {
  return (PIPELINE_LABELS as Record<string, string>)[s] ?? s
}

export function pipelineChipClass(s: string): string {
  switch (s) {
    case 'paid':                 return 'bg-emerald-100 text-emerald-700'
    case 'pilot_active':         return 'bg-teal-100 text-teal-700'
    case 'results_sent':         return 'bg-cyan-100 text-cyan-700'
    case 'pilot_offered':        return 'bg-indigo-100 text-indigo-700'
    case 'interested':           return 'bg-blue-100 text-blue-700'
    case 'follow_up_sent':
    case 'call_attempted':
    case 'email_1_sent':         return 'bg-amber-100 text-amber-700'
    case 'decision_maker_found': return 'bg-violet-100 text-violet-700'
    case 'follow_up_later':      return 'bg-orange-100 text-orange-700'
    case 'lost':                 return 'bg-red-100 text-red-700'
    default:                     return 'bg-gray-100 text-gray-600' // prospect_found
  }
}

export function isValidPipelineStage(s: string): s is PipelineStage {
  return (pipelineStageValues as readonly string[]).includes(s)
}

export type AcquisitionStats = {
  paidDealers: number
  goal: number
  activePilots: number
  interested: number
  prospectsContacted: number
  mrr: number
  followUpsDue: number
}

export type AcquisitionRow = {
  id: string
  dealershipName: string
  city: string | null
  state: string | null
  dealerType: string | null
  website: string | null
  mainPhone: string | null
  bestContactName: string | null
  bestContactTitle: string | null
  publicEmail: string | null
  sourceUrl: string | null
  fitNotes: string | null
  pipelineStatus: PipelineStage
  lastContactedAt: string | null
  nextFollowUpAt: string | null
  monthlyPrice: number | null
  paymentStatus: string | null
  pilotStartDate: string | null
  pilotEndDate: string | null
}

export type AcquisitionFilters = {
  stage?: string
  state?: string
  due?: 'due' | 'overdue'
  pilots?: boolean
  paid?: boolean
  q?: string
}

const CONTACTED_STAGES = new Set<string>([
  'email_1_sent', 'call_attempted', 'follow_up_sent', 'interested',
  'pilot_offered', 'pilot_active', 'results_sent', 'paid',
])

/** Single fetch: stats computed over ALL non-archived prospects; rows filtered. */
export async function getAcquisitionOverview(
  filters: AcquisitionFilters = {},
  now: Date = new Date(),
): Promise<{ stats: AcquisitionStats; rows: AcquisitionRow[]; states: string[] }> {
  const all = await db
    .select()
    .from(dealerProspects)
    .where(isNull(dealerProspects.archivedAt))
    .orderBy(desc(dealerProspects.createdAt))
    .limit(1000)

  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999)
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0)

  const stats: AcquisitionStats = {
    goal: GOAL_PAID_DEALERS,
    paidDealers: 0, activePilots: 0, interested: 0,
    prospectsContacted: 0, mrr: 0, followUpsDue: 0,
  }
  const stateSet = new Set<string>()

  for (const p of all) {
    const stage = p.pipelineStatus
    if (stage === 'paid') { stats.paidDealers++; stats.mrr += p.monthlyPrice ?? 0 }
    if (stage === 'pilot_active') stats.activePilots++
    if (stage === 'interested') stats.interested++
    if (p.lastContactedAt || CONTACTED_STAGES.has(stage)) stats.prospectsContacted++
    if (p.nextFollowUpAt && p.nextFollowUpAt <= endOfToday && stage !== 'paid' && stage !== 'lost') {
      stats.followUpsDue++
    }
    if (p.state) stateSet.add(p.state)
  }

  const q = (filters.q ?? '').trim().toLowerCase()
  const filtered = all.filter(p => {
    if (filters.stage && p.pipelineStatus !== filters.stage) return false
    if (filters.state && p.state !== filters.state) return false
    if (filters.pilots && p.pipelineStatus !== 'pilot_active') return false
    if (filters.paid && p.pipelineStatus !== 'paid') return false
    if (filters.due === 'due') {
      if (!p.nextFollowUpAt || p.nextFollowUpAt > endOfToday) return false
    }
    if (filters.due === 'overdue') {
      if (!p.nextFollowUpAt || p.nextFollowUpAt >= startOfToday) return false
    }
    if (q) {
      const hay = [p.dealershipName, p.city, p.state, p.publicEmail, p.bestContactName]
        .filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  const rows: AcquisitionRow[] = filtered.map(p => ({
    id: p.id,
    dealershipName: p.dealershipName,
    city: p.city, state: p.state, dealerType: p.dealerType,
    website: p.website, mainPhone: p.mainPhone,
    bestContactName: p.bestContactName, bestContactTitle: p.bestContactTitle,
    publicEmail: p.publicEmail, sourceUrl: p.sourceUrl, fitNotes: p.fitNotes,
    pipelineStatus: p.pipelineStatus,
    lastContactedAt: p.lastContactedAt ? p.lastContactedAt.toISOString() : null,
    nextFollowUpAt: p.nextFollowUpAt ? p.nextFollowUpAt.toISOString() : null,
    monthlyPrice: p.monthlyPrice, paymentStatus: p.paymentStatus,
    pilotStartDate: p.pilotStartDate ? p.pilotStartDate.toISOString() : null,
    pilotEndDate: p.pilotEndDate ? p.pilotEndDate.toISOString() : null,
  }))

  return { stats, rows, states: Array.from(stateSet).sort() }
}
