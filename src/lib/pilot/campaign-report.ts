/**
 * Campaign Report — read-only aggregator for a pilot batch.
 *
 * Powers the dealer-facing and admin-facing report pages plus their CSV
 * exports. Pure read path:
 *   - no writes
 *   - no enqueues
 *   - no Telnyx / Stripe calls
 *   - does not mutate pilot_batches.pilot_report (unlike generatePilotReport
 *     in live-pilot-execution.ts, which is the persistence path for the
 *     post-completion snapshot)
 *
 * Tenant scoping is enforced inside getCampaignReport via the tenantId
 * argument:
 *   - dealer pages pass session.user.tenantId so a dealer cannot read another
 *     tenant's batch
 *   - admin pages pass null to read any batch
 */

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  pilotBatches,
  leads,
  conversations,
  messages,
  optOuts,
  handoffTasks,
  pilotLeadImports,
  workflows,
  tenants,
} from '@/lib/db/schema'
import type { ReplyClassification } from '@/lib/messaging/classify-reply'

// ── Public types ──────────────────────────────────────────────────────────────

export type CampaignReportLeadRow = {
  leadId: string
  firstName: string
  lastName: string
  phone: string
  vehicleOfInterest: string | null
  sendStatus: string
  skipReason: string | null
  replyClassification: ReplyClassification | string | null
  replyBody: string | null
  lastReplyAt: string | null
  optedOut: boolean
  handoffTaskId: string | null
  handoffStatus: string | null
}

export type CampaignReportImportStats = {
  /** Distinct rows recorded in pilot_lead_imports for this tenant — best-effort. */
  totalImported: number | null
  eligible: number | null
  suppressed: number | null
  duplicates: number | null
  invalidPhone: number | null
  /** When false, we couldn't tie import rows to this batch's leads at all
   *  (e.g. the batch was created from leads that were imported via a different
   *  path). UI should hide the import section instead of showing zeros. */
  hasImportData: boolean
}

export type CampaignReportClassificationCounts = {
  hot: number              // hot_appointment + hot_inventory + hot_payment
  warm: number             // warm_trade + warm_finance
  needsHuman: number       // needs_human_review
  notNow: number
  neutralUnclear: number
  notInterested: number
  alreadyBought: number    // "bought elsewhere"
  wrongNumber: number      // "bad number"
  angryOrComplaint: number
}

export type CampaignReportFunnelStep = {
  label: string
  value: number
  detail?: string
}

export type CampaignReport = {
  generatedAt: string
  batchId: string
  tenantId: string
  tenantName: string
  workflowName: string
  status: string
  isFirstPilot: boolean
  startedAt: string | null
  completedAt: string | null
  cancelledAt: string | null
  lastActivityAt: string | null

  // ── Lead funnel ────────────────────────────────────────────────────────────
  totalLeadsInBatch: number
  importStats: CampaignReportImportStats

  // ── Message funnel ─────────────────────────────────────────────────────────
  messagesQueued: number
  messagesSent: number
  messagesDelivered: number
  messagesFailed: number

  // ── Reply funnel ───────────────────────────────────────────────────────────
  repliesReceived: number
  /** replies / sent, in 0..1; null when sent == 0. */
  replyRate: number | null
  optOuts: number

  // ── Classification breakdown ───────────────────────────────────────────────
  classification: CampaignReportClassificationCounts

  // ── Handoffs ───────────────────────────────────────────────────────────────
  handoffsCreated: number
  handoffsResolved: number

  // ── Tables / lists ─────────────────────────────────────────────────────────
  hotLeads: CampaignReportLeadRow[]
  needsHumanLeads: CampaignReportLeadRow[]
  allLeads: CampaignReportLeadRow[]

  // ── Funnel for UI display (already computed in one place) ──────────────────
  funnel: CampaignReportFunnelStep[]

  // ── Manager summary (deterministic, template-built) ────────────────────────
  managerSummary: string
}

export type GetCampaignReportOptions = {
  batchId: string
  /** When provided, the batch's tenantId must match — used for dealer access. */
  tenantId: string | null
}

export type GetCampaignReportResult =
  | { ok: true; report: CampaignReport }
  | { ok: false; reason: 'not_found' }

// ── Classification bucket helpers ─────────────────────────────────────────────

const HOT_CLASSIFICATIONS = new Set<string>([
  'hot_appointment', 'hot_inventory', 'hot_payment',
])
const WARM_CLASSIFICATIONS = new Set<string>([
  'warm_trade', 'warm_finance',
])

// ── Main loader ───────────────────────────────────────────────────────────────

export async function getCampaignReport(
  opts: GetCampaignReportOptions,
): Promise<GetCampaignReportResult> {
  const { batchId, tenantId } = opts

  const whereBatch = tenantId
    ? and(eq(pilotBatches.id, batchId), eq(pilotBatches.tenantId, tenantId))
    : eq(pilotBatches.id, batchId)

  const batch = await db.query.pilotBatches.findFirst({
    where: whereBatch,
    with: {
      leads: true,
      tenant: true,
      workflow: true,
    },
  })
  if (!batch) return { ok: false, reason: 'not_found' }

  const batchLeads = batch.leads
  const leadIds = batchLeads.map(bl => bl.leadId)

  // Load full lead records
  const leadRows = leadIds.length > 0
    ? await db.query.leads.findMany({ where: inArray(leads.id, leadIds) })
    : []
  const leadMap = new Map(leadRows.map(l => [l.id, l]))

  // Load conversations + messages for those leads
  const convRows = leadIds.length > 0
    ? await db.query.conversations.findMany({
        where: inArray(conversations.leadId, leadIds),
        with: { messages: true },
      })
    : []
  const allMessages = convRows.flatMap(c => c.messages)
  const messagesByLeadId = new Map<string, typeof allMessages>()
  for (const conv of convRows) {
    messagesByLeadId.set(conv.leadId, conv.messages)
  }

  // Load opt-outs for these leads' phones (scoped to batch tenant)
  const phones = leadRows.map(l => l.phone)
  const optOutRows = phones.length > 0
    ? await db.select().from(optOuts).where(and(
        eq(optOuts.tenantId, batch.tenantId),
        inArray(optOuts.phone, phones),
      ))
    : []
  const optOutPhones = new Set(optOutRows.map(o => o.phone))

  // Load handoff tasks for these leads
  const handoffRows = leadIds.length > 0
    ? await db.query.handoffTasks.findMany({
        where: inArray(handoffTasks.leadId, leadIds),
      })
    : []
  const handoffByLeadId = new Map<string, typeof handoffRows[number]>()
  for (const h of handoffRows) {
    // Pick the most recent for the row table — but count all distinct rows separately.
    const existing = handoffByLeadId.get(h.leadId)
    if (!existing || h.createdAt > existing.createdAt) {
      handoffByLeadId.set(h.leadId, h)
    }
  }

  // Load import rows tied to these leads (best-effort — set on batch creation
  // when a row's leadId was filled in). When none of the batch leads have a
  // matching import row, we surface hasImportData = false to the UI.
  const importRows = leadIds.length > 0
    ? await db
        .select()
        .from(pilotLeadImports)
        .where(and(
          eq(pilotLeadImports.tenantId, batch.tenantId),
          inArray(pilotLeadImports.leadId, leadIds),
        ))
    : []

  // ── Message funnel ──────────────────────────────────────────────────────────
  let messagesQueued = 0
  let messagesSent = 0
  let messagesDelivered = 0
  let messagesFailed = 0
  let lastActivityAt: Date | null = batch.startedAt ?? batch.createdAt ?? null

  for (const m of allMessages) {
    if (m.direction !== 'outbound') continue
    // Status reflects current state; we attribute one message to one bucket
    // (the most-advanced state it has reached).
    if (m.status === 'delivered') messagesDelivered++
    else if (m.status === 'sent') messagesSent++
    else if (m.status === 'failed') messagesFailed++
    else if (m.status === 'queued') messagesQueued++
    // also count delivered as sent at-least-once for funnel display
    if (m.status === 'delivered') messagesSent++

    const candidates: Array<Date | null | undefined> = [
      m.sentAt, m.deliveredAt, m.createdAt,
    ]
    for (const c of candidates) {
      if (c && (!lastActivityAt || c > lastActivityAt)) lastActivityAt = c
    }
  }
  // ensure inbound replies bump last-activity too
  for (const m of allMessages) {
    if (m.direction !== 'inbound') continue
    if (m.createdAt && (!lastActivityAt || m.createdAt > lastActivityAt)) {
      lastActivityAt = m.createdAt
    }
  }

  // ── Reply funnel + classification breakdown ─────────────────────────────────
  let repliesReceived = 0
  let optOutCount = 0

  const classification: CampaignReportClassificationCounts = {
    hot: 0, warm: 0, needsHuman: 0, notNow: 0, neutralUnclear: 0,
    notInterested: 0, alreadyBought: 0, wrongNumber: 0, angryOrComplaint: 0,
  }

  const allLeadRows: CampaignReportLeadRow[] = []

  for (const bl of batchLeads) {
    const lead = leadMap.get(bl.leadId)
    if (!lead) continue

    const inbound = (messagesByLeadId.get(lead.id) ?? []).filter(m => m.direction === 'inbound')
    const optedOut = optOutPhones.has(lead.phone)
    const handoff = handoffByLeadId.get(lead.id) ?? null

    const cls = bl.replyClassification ?? null
    const hasReply = cls != null || inbound.length > 0
    if (hasReply) repliesReceived++
    if (optedOut) optOutCount++

    if (cls) {
      if (HOT_CLASSIFICATIONS.has(cls)) classification.hot++
      else if (WARM_CLASSIFICATIONS.has(cls)) classification.warm++
      else if (cls === 'needs_human_review') classification.needsHuman++
      else if (cls === 'not_now') classification.notNow++
      else if (cls === 'not_interested') classification.notInterested++
      else if (cls === 'already_bought') classification.alreadyBought++
      else if (cls === 'wrong_number') classification.wrongNumber++
      else if (cls === 'angry_or_complaint') classification.angryOrComplaint++
      else classification.neutralUnclear++
    }

    allLeadRows.push({
      leadId: lead.id,
      firstName: lead.firstName,
      lastName: lead.lastName,
      phone: lead.phone,
      vehicleOfInterest: lead.vehicleOfInterest ?? null,
      sendStatus: bl.sendStatus,
      skipReason: bl.skipReason ?? null,
      replyClassification: cls,
      replyBody: lead.lastReplyBody ?? null,
      lastReplyAt: lead.lastCustomerReplyAt?.toISOString() ?? null,
      optedOut,
      handoffTaskId: bl.handoffTaskId ?? null,
      handoffStatus: handoff?.status ?? null,
    })
  }

  const hotLeads = allLeadRows.filter(r =>
    r.replyClassification != null && HOT_CLASSIFICATIONS.has(r.replyClassification),
  )
  const needsHumanLeads = allLeadRows.filter(r => {
    const c = r.replyClassification
    if (!c) return false
    return c === 'needs_human_review' || WARM_CLASSIFICATIONS.has(c)
  })

  // ── Handoff resolution counts ───────────────────────────────────────────────
  const handoffsCreated = handoffRows.length
  const handoffsResolved = handoffRows.filter(h =>
    h.status === 'resolved' || h.status === 'dismissed',
  ).length

  // ── Import stats (best-effort) ──────────────────────────────────────────────
  let importStats: CampaignReportImportStats
  if (importRows.length === 0) {
    importStats = {
      totalImported: null,
      eligible: null,
      suppressed: null,
      duplicates: null,
      invalidPhone: null,
      hasImportData: false,
    }
  } else {
    let eligible = 0
    let suppressed = 0
    let duplicates = 0
    let invalidPhone = 0
    for (const r of importRows) {
      if (r.importStatus === 'eligible' || r.importStatus === 'selected') eligible++
      if (r.importStatus === 'blocked' || r.importStatus === 'excluded') suppressed++
      if (r.duplicateOfLeadId || r.duplicateOfImportId) duplicates++
      if (!r.phone) invalidPhone++
    }
    importStats = {
      totalImported: importRows.length,
      eligible,
      suppressed,
      duplicates,
      invalidPhone,
      hasImportData: true,
    }
  }

  // ── Reply rate ──────────────────────────────────────────────────────────────
  const sentDenom = messagesSent + messagesDelivered + messagesFailed
  const replyRate = sentDenom > 0 ? repliesReceived / sentDenom : null

  // ── Funnel for UI ───────────────────────────────────────────────────────────
  const funnel: CampaignReportFunnelStep[] = [
    { label: 'In batch', value: batchLeads.length },
    { label: 'Messages queued', value: messagesQueued },
    { label: 'Messages sent', value: messagesSent },
    { label: 'Delivered', value: messagesDelivered },
    { label: 'Replies', value: repliesReceived },
    { label: 'Hot + warm', value: classification.hot + classification.warm },
    { label: 'Handoffs created', value: handoffsCreated },
    { label: 'Handoffs resolved', value: handoffsResolved },
  ]

  // ── Manager summary (deterministic) ────────────────────────────────────────
  const managerSummary = buildManagerSummary({
    workflowName: batch.workflow?.name ?? 'this workflow',
    totalLeadsInBatch: batchLeads.length,
    messagesSent: messagesSent + messagesDelivered, // include "made it to provider"
    messagesDelivered,
    messagesFailed,
    repliesReceived,
    replyRate,
    classification,
    optOuts: optOutCount,
    handoffsCreated,
    handoffsResolved,
    isFirstPilot: batch.isFirstPilot,
    status: batch.status,
  })

  const report: CampaignReport = {
    generatedAt: new Date().toISOString(),
    batchId: batch.id,
    tenantId: batch.tenantId,
    tenantName: batch.tenant?.name ?? batch.tenantId,
    workflowName: batch.workflow?.name ?? '—',
    status: batch.status,
    isFirstPilot: batch.isFirstPilot,
    startedAt: batch.startedAt?.toISOString() ?? null,
    completedAt: batch.completedAt?.toISOString() ?? null,
    cancelledAt: batch.cancelledAt?.toISOString() ?? null,
    lastActivityAt: lastActivityAt?.toISOString() ?? null,

    totalLeadsInBatch: batchLeads.length,
    importStats,

    messagesQueued,
    messagesSent,
    messagesDelivered,
    messagesFailed,

    repliesReceived,
    replyRate,
    optOuts: optOutCount,

    classification,

    handoffsCreated,
    handoffsResolved,

    hotLeads,
    needsHumanLeads,
    allLeads: allLeadRows,

    funnel,

    managerSummary,
  }

  return { ok: true, report }
}

// ── Manager summary builder (no LLM) ──────────────────────────────────────────

type ManagerSummaryInput = {
  workflowName: string
  totalLeadsInBatch: number
  messagesSent: number
  messagesDelivered: number
  messagesFailed: number
  repliesReceived: number
  replyRate: number | null
  classification: CampaignReportClassificationCounts
  optOuts: number
  handoffsCreated: number
  handoffsResolved: number
  isFirstPilot: boolean
  status: string
}

function buildManagerSummary(p: ManagerSummaryInput): string {
  const parts: string[] = []

  const label = p.isFirstPilot ? 'initial campaign' : 'campaign'
  parts.push(`This ${label} ran "${p.workflowName}" against ${p.totalLeadsInBatch} ${pl(p.totalLeadsInBatch, 'lead', 'leads')}.`)

  if (p.messagesSent === 0 && p.messagesFailed === 0) {
    parts.push('No messages have been sent yet, so there are no outcomes to report.')
    if (p.status === 'draft' || p.status === 'previewed' || p.status === 'approved') {
      parts.push(`The batch is currently in "${p.status}" — sending has not started.`)
    }
    return parts.join(' ')
  }

  const sentLine = `Of those, ${p.messagesSent} ${pl(p.messagesSent, 'message was', 'messages were')} sent`
    + (p.messagesDelivered > 0 ? `, ${p.messagesDelivered} confirmed delivered` : '')
    + (p.messagesFailed > 0 ? `, and ${p.messagesFailed} failed at the carrier` : '')
    + '.'
  parts.push(sentLine)

  if (p.repliesReceived > 0) {
    const ratePct = p.replyRate != null ? `${(p.replyRate * 100).toFixed(1)}%` : null
    parts.push(
      `${p.repliesReceived} ${pl(p.repliesReceived, 'lead replied', 'leads replied')}` +
      (ratePct ? ` (${ratePct} reply rate)` : '') + '.',
    )
  } else {
    parts.push('No replies have come in yet.')
  }

  const hot  = p.classification.hot
  const warm = p.classification.warm
  const nh   = p.classification.needsHuman
  if (hot + warm + nh > 0) {
    const fragments: string[] = []
    if (hot  > 0) fragments.push(`${hot} ${pl(hot, 'hot lead', 'hot leads')}`)
    if (warm > 0) fragments.push(`${warm} ${pl(warm, 'warm reply', 'warm replies')}`)
    if (nh   > 0) fragments.push(`${nh} flagged for human follow-up`)
    parts.push(`The system found ${joinList(fragments)}.`)
  }

  if (p.classification.alreadyBought + p.classification.notInterested + p.classification.wrongNumber > 0) {
    const terminals: string[] = []
    if (p.classification.alreadyBought > 0) terminals.push(`${p.classification.alreadyBought} bought elsewhere`)
    if (p.classification.notInterested > 0) terminals.push(`${p.classification.notInterested} not interested`)
    if (p.classification.wrongNumber   > 0) terminals.push(`${p.classification.wrongNumber} wrong number`)
    parts.push(`${capitalizeFirst(joinList(terminals))}.`)
  }

  if (p.optOuts > 0) {
    parts.push(`${p.optOuts} ${pl(p.optOuts, 'lead', 'leads')} opted out via STOP.`)
  }
  if (p.classification.angryOrComplaint > 0) {
    parts.push(`${p.classification.angryOrComplaint} ${pl(p.classification.angryOrComplaint, 'message was', 'messages were')} flagged as a complaint — review before the next send.`)
  }

  if (p.handoffsCreated > 0) {
    parts.push(`${p.handoffsCreated} ${pl(p.handoffsCreated, 'handoff was', 'handoffs were')} created${p.handoffsResolved > 0 ? `, ${p.handoffsResolved} resolved so far` : ''}.`)
  }

  // Verdict line
  if (p.classification.angryOrComplaint > 0) {
    parts.push('Recommendation: pause and review message copy before the next send.')
  } else if (p.optOuts > 0 && p.messagesSent > 0 && p.optOuts / p.messagesSent > 0.2) {
    parts.push('Recommendation: opt-out rate is high — review targeting before expanding.')
  } else if (hot + warm > 0) {
    parts.push('Recommendation: ready to expand — the workflow is producing buying signal.')
  } else if (p.repliesReceived === 0 && p.messagesSent > 0) {
    parts.push('Recommendation: keep this campaign running and check back in 24–48 hours.')
  } else {
    parts.push('Recommendation: review the per-lead detail below before deciding next steps.')
  }

  return parts.join(' ')
}

function pl(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural
}

function joinList(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}

// ── CSV export ────────────────────────────────────────────────────────────────

const CSV_COLUMNS = [
  'leadId',
  'firstName',
  'lastName',
  'phone',
  'vehicleOfInterest',
  'sendStatus',
  'skipReason',
  'replyClassification',
  'replyBody',
  'lastReplyAt',
  'optedOut',
  'handoffTaskId',
  'handoffStatus',
] as const

export function reportToCSV(report: CampaignReport): string {
  const header = CSV_COLUMNS.join(',')
  const rows = report.allLeads.map(r => CSV_COLUMNS.map(col => csvEscape(r[col])).join(','))
  return [header, ...rows].join('\n')
}

function csvEscape(value: unknown): string {
  if (value == null) return ''
  let s = String(value)
  // Always quote — keeps phones / commas / multiline replies safe in any spreadsheet
  s = s.replace(/"/g, '""').replace(/\r?\n/g, ' ')
  return `"${s}"`
}

// Silence unused-import warning — tenants/workflows are referenced via the
// `with:` relations on db.query.pilotBatches.findFirst.
void tenants
void workflows
void messages
