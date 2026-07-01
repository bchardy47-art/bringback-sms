'use server'

/**
 * Dealer Acquisition CRM server actions (V1). All mutations are admin-tier
 * (internal pipeline edits — not outreach sends, so assertAdmin not assertBrian).
 * Every action re-asserts server-side and revalidates the page.
 */

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dealerProspects, outreachNotes } from '@/lib/db/schema'
import { assertAdmin } from '@/lib/admin/access'
import { trackEvent } from '@/lib/activity/track'
import { isValidPipelineStage, pipelineLabel } from '@/lib/outreach/acquisition'
import { normalizeEmail } from '@/lib/outreach/eligibility'

function revalidate() {
  revalidatePath('/admin/acquisition')
}

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim()
const uuidOk = (v: string) => /^[0-9a-f-]{36}$/i.test(v)

function intOrNull(v: string): number | null {
  if (!v) return null
  const n = Math.round(Number(v.replace(/[^0-9.-]/g, '')))
  return Number.isFinite(n) ? n : null
}

function dateOrNull(v: string): Date | null {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

async function actor() {
  const a = await assertAdmin()
  return { id: a.id, email: a.email }
}

async function setFields(id: string, set: Partial<typeof dealerProspects.$inferInsert>, event: string, meta: Record<string, unknown>) {
  const a = await actor()
  if (!uuidOk(id)) return
  await db.update(dealerProspects)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(dealerProspects.id, id))
  await trackEvent(event, { actor: { id: a.id, email: a.email, role: 'admin' }, metadata: { prospectId: id, ...meta } })
  revalidate()
}

// ── Quick actions ────────────────────────────────────────────────────────────

export async function markEmailSentAction(fd: FormData) {
  const now = new Date()
  const followUp = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000) // +2 days
  await setFields(s(fd, 'id'), {
    pipelineStatus: 'email_1_sent', lastContactedAt: now, nextFollowUpAt: followUp,
  }, 'acq_mark_email_sent', {})
}

export async function markCallAttemptedAction(fd: FormData) {
  await setFields(s(fd, 'id'), {
    pipelineStatus: 'call_attempted', lastContactedAt: new Date(),
  }, 'acq_mark_call_attempted', {})
}

export async function markInterestedAction(fd: FormData) {
  await setFields(s(fd, 'id'), { pipelineStatus: 'interested' }, 'acq_mark_interested', {})
}

export async function startPilotAction(fd: FormData) {
  const start = dateOrNull(s(fd, 'pilotStartDate')) ?? new Date()
  await setFields(s(fd, 'id'), {
    pipelineStatus: 'pilot_active', pilotStartDate: start,
  }, 'acq_start_pilot', {})
}

export async function markPaidAction(fd: FormData) {
  const price = intOrNull(s(fd, 'monthlyPrice'))
  const founder = s(fd, 'founderPricing') === 'on'
  await setFields(s(fd, 'id'), {
    pipelineStatus: 'paid', paymentStatus: 'active', convertedAt: new Date(),
    monthlyPrice: price, founderPricing: founder,
  }, 'acq_mark_paid', { monthlyPrice: price, founder })
}

export async function markLostAction(fd: FormData) {
  const id = s(fd, 'id')
  const reason = s(fd, 'reason')
  if (!uuidOk(id) || !reason) return // reason is required
  const a = await actor()
  await db.update(dealerProspects)
    .set({ pipelineStatus: 'lost', updatedAt: new Date() })
    .where(eq(dealerProspects.id, id))
  await db.insert(outreachNotes).values({
    prospectId: id,
    authorUserId: uuidOk(a.id) ? a.id : null,
    authorEmail: a.email,
    body: `Marked Lost — reason: ${reason}`,
  })
  await trackEvent('acq_mark_lost', { actor: { id: a.id, email: a.email, role: 'admin' }, metadata: { prospectId: id, reason } })
  revalidate()
}

// ── Notes / follow-up / stage ────────────────────────────────────────────────

export async function addNoteAction(fd: FormData) {
  const id = s(fd, 'id')
  const body = s(fd, 'body')
  if (!uuidOk(id) || !body) return
  const a = await actor()
  await db.insert(outreachNotes).values({
    prospectId: id,
    authorUserId: uuidOk(a.id) ? a.id : null,
    authorEmail: a.email,
    body,
  })
  revalidate()
}

export async function setNextFollowUpAction(fd: FormData) {
  const id = s(fd, 'id')
  if (!uuidOk(id)) return
  await setFields(id, { nextFollowUpAt: dateOrNull(s(fd, 'date')) }, 'acq_set_follow_up', {})
}

export async function setPipelineStatusAction(fd: FormData) {
  const id = s(fd, 'id')
  const stage = s(fd, 'stage')
  if (!uuidOk(id) || !isValidPipelineStage(stage)) return
  await setFields(id, { pipelineStatus: stage }, 'acq_set_stage', { stage, label: pipelineLabel(stage) })
}

export async function updatePilotMetricsAction(fd: FormData) {
  const id = s(fd, 'id')
  if (!uuidOk(id)) return
  await setFields(id, {
    pilotLeadCount:         intOrNull(s(fd, 'pilotLeadCount')),
    pilotTextsSent:         intOrNull(s(fd, 'pilotTextsSent')),
    pilotTotalReplies:      intOrNull(s(fd, 'pilotTotalReplies')),
    pilotPositiveReplies:   intOrNull(s(fd, 'pilotPositiveReplies')),
    pilotAppointments:      intOrNull(s(fd, 'pilotAppointments')),
    pilotOptOuts:           intOrNull(s(fd, 'pilotOptOuts')),
    pilotBadNumbers:        intOrNull(s(fd, 'pilotBadNumbers')),
    pilotSoldUnitsReported: intOrNull(s(fd, 'pilotSoldUnitsReported')),
    estimatedValueCreated:  intOrNull(s(fd, 'estimatedValueCreated')),
    pilotEndDate:           dateOrNull(s(fd, 'pilotEndDate')),
  }, 'acq_update_pilot_metrics', {})
}

// ── Create prospect ──────────────────────────────────────────────────────────

export async function createProspectAction(fd: FormData) {
  const a = await actor()
  const dealershipName = s(fd, 'dealershipName')
  if (!dealershipName) return
  const emailRaw = s(fd, 'publicEmail')
  await db.insert(dealerProspects).values({
    dealershipName,
    city: s(fd, 'city') || null,
    state: s(fd, 'state') || null,
    dealerType: s(fd, 'dealerType') || null,
    website: s(fd, 'website') || null,
    mainPhone: s(fd, 'mainPhone') || null,
    publicEmail: emailRaw ? normalizeEmail(emailRaw) : null,
    bestContactName: s(fd, 'bestContactName') || null,
    bestContactTitle: s(fd, 'bestContactTitle') || null,
    sourceUrl: s(fd, 'sourceUrl') || null,
    fitNotes: s(fd, 'fitNotes') || null,
    pipelineStatus: 'prospect_found',
    status: 'new',
    createdByEmail: a.email,
    createdByUserId: uuidOk(a.id) ? a.id : null,
  })
  await trackEvent('acq_create_prospect', { actor: { id: a.id, email: a.email, role: 'admin' }, metadata: { dealershipName } })
  revalidate()
}
