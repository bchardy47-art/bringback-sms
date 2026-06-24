'use server'

/**
 * Outreach server actions. Two access tiers, enforced server-side here (never
 * trust a hidden button):
 *
 *   assertAdmin() — view-state mutations: import, status changes, notes,
 *                   suppression add. Reduce-only / non-sending.
 *   assertBrian() — the dangerous send tools: test send, real invite, batch
 *                   send. Restricted to brian@dlr-sms.com.
 */

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  dealerProspects, outreachNotes, outreachSuppressions, type ProspectStatus,
} from '@/lib/db/schema'
import { assertAdmin, assertBrian } from '@/lib/admin/access'
import { trackEvent } from '@/lib/activity/track'
import { importProspects } from '@/lib/outreach/import'
import { sendTestToBrian, sendMonthlyInvite, sendBatch, type BatchResult } from '@/lib/outreach/send'
import { normalizeEmail } from '@/lib/outreach/eligibility'

function revalidateOutreach(prospectId?: string) {
  revalidatePath('/admin/outreach')
  revalidatePath('/admin/outreach/sends')
  if (prospectId) revalidatePath(`/admin/outreach/prospects/${prospectId}`)
}

// ── Import ───────────────────────────────────────────────────────────────────

export async function importProspectsAction(_prev: unknown, formData: FormData) {
  const actor = await assertAdmin()
  const text = String(formData.get('csv') ?? '')
  if (!text.trim()) return { ok: false as const, error: 'Paste CSV/TSV rows first.' }

  const summary = await importProspects(text, { id: actor.id, email: actor.email })
  await trackEvent('outreach_prospect_imported', {
    actor: { id: actor.id, email: actor.email, role: 'admin' },
    metadata: { created: summary.created, updated: summary.updated, skipped: summary.skippedDuplicates },
  })
  revalidateOutreach()
  return { ok: true as const, summary }
}

// ── Status changes (admin) ───────────────────────────────────────────────────

const ALLOWED_STATUS: ProspectStatus[] = [
  'new', 'ready', 'sent_intro', 'follow_up', 'replied', 'interested',
  'demo_booked', 'not_interested', 'bad_email', 'missing_contact', 'archived',
]

export async function setStatusAction(formData: FormData) {
  const actor = await assertAdmin()
  const id = String(formData.get('prospectId') ?? '')
  const status = String(formData.get('status') ?? '') as ProspectStatus
  if (!id || !ALLOWED_STATUS.includes(status)) return

  const set: Partial<typeof dealerProspects.$inferInsert> = { status, updatedAt: new Date() }
  if (status === 'archived') set.archivedAt = new Date()
  await db.update(dealerProspects).set(set).where(eq(dealerProspects.id, id))

  await trackEvent('outreach_prospect_status_changed', {
    actor: { id: actor.id, email: actor.email, role: 'admin' },
    metadata: { prospectId: id, status },
  })
  revalidateOutreach(id)
}

// ── Do-not-contact (admin) — reduce-only, also writes a suppression row ───────

export async function markDoNotContactAction(formData: FormData) {
  const actor = await assertAdmin()
  const id = String(formData.get('prospectId') ?? '')
  const reason = String(formData.get('reason') ?? '').trim() || 'manual'
  if (!id) return

  const rows = await db.select().from(dealerProspects).where(eq(dealerProspects.id, id)).limit(1)
  const prospect = rows[0]
  if (!prospect) return

  const now = new Date()
  await db.update(dealerProspects).set({
    status: 'do_not_contact', doNotContactAt: now, doNotContactReason: reason, updatedAt: now,
  }).where(eq(dealerProspects.id, id))

  const email = normalizeEmail(prospect.publicEmail)
  if (email) {
    await db.insert(outreachSuppressions).values({
      email,
      domain: email.includes('@') ? email.split('@')[1] : null,
      dealershipName: prospect.dealershipName,
      reason,
      source: 'manual_dnc',
      createdByEmail: actor.email,
    })
  }

  await trackEvent('outreach_prospect_marked_dnc', {
    actor: { id: actor.id, email: actor.email, role: 'admin' },
    metadata: { prospectId: id, reason },
  })
  revalidateOutreach(id)
}

// ── Notes (admin) ────────────────────────────────────────────────────────────

export async function addProspectNoteAction(formData: FormData) {
  const actor = await assertAdmin()
  const id = String(formData.get('prospectId') ?? '')
  const body = String(formData.get('body') ?? '').trim()
  if (!id || !body) return
  await db.insert(outreachNotes).values({
    prospectId: id,
    authorUserId: /^[0-9a-f-]{36}$/i.test(actor.id) ? actor.id : null,
    authorEmail: actor.email,
    body,
  })
  revalidateOutreach(id)
}

// ── Suppression add (admin) ──────────────────────────────────────────────────

export async function addSuppressionAction(formData: FormData) {
  const actor = await assertAdmin()
  const emailRaw = String(formData.get('email') ?? '').trim()
  const domainRaw = String(formData.get('domain') ?? '').trim().toLowerCase()
  const reason = String(formData.get('reason') ?? '').trim() || 'manual'
  if (!emailRaw && !domainRaw) return
  await db.insert(outreachSuppressions).values({
    email: emailRaw ? normalizeEmail(emailRaw) : null,
    domain: domainRaw || null,
    reason,
    source: 'manual',
    createdByEmail: actor.email,
  })
  revalidatePath('/admin/outreach/suppression')
  revalidateOutreach()
}

// ── Sends (BRIAN-ONLY) ───────────────────────────────────────────────────────

export async function sendTestAction(formData: FormData) {
  const actor = await assertBrian()
  const id = String(formData.get('prospectId') ?? '')
  const templateKey = String(formData.get('templateKey') ?? 'what_is_dlr')
  if (!id) return { ok: false as const, error: 'missing prospect' }
  const outcome = await sendTestToBrian(id, templateKey, { id: actor.id, email: actor.email })
  revalidateOutreach(id)
  return { ok: outcome.ok, outcome }
}

export async function sendInviteAction(formData: FormData) {
  const actor = await assertBrian()
  const id = String(formData.get('prospectId') ?? '')
  const templateKey = String(formData.get('templateKey') ?? 'what_is_dlr')
  if (!id) return { ok: false as const, error: 'missing prospect' }
  const outcome = await sendMonthlyInvite(id, templateKey, { id: actor.id, email: actor.email })
  revalidateOutreach(id)
  return { ok: outcome.ok, outcome }
}

export async function sendBatchAction(prospectIds: string[], templateKey = 'what_is_dlr'): Promise<{ ok: boolean; result?: BatchResult; error?: string }> {
  const actor = await assertBrian()
  if (!Array.isArray(prospectIds) || prospectIds.length === 0) {
    return { ok: false, error: 'No prospects selected.' }
  }
  const result = await sendBatch(prospectIds, templateKey, { id: actor.id, email: actor.email })
  revalidateOutreach()
  return { ok: true, result }
}
