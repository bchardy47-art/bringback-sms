'use server'

import { db } from '@/lib/db'
import { demoLeads } from '@/lib/db/schema'
import { sendDemoRequestNotification } from '@/lib/email/demo-request-notification'
import { trackEvent } from '@/lib/activity/track'

type BookDemoInput = {
  dealershipName:    string
  decisionMakerName: string
  phone:             string
  email:             string
  /** Optional dealer-page attribution (e.g. from /for/<slug> → challenge CTA). */
  dealer?:           string
}

// Allowlist of live personalized dealer pages. A `dealer` value is only stored
// as attribution when it matches a known slug — this prevents a crafted
// ?dealer=… URL from attributing (impersonating) an arbitrary dealership.
const LIVE_DEALER_SLUGS = new Set<string>(['mountainland-auto-sales'])

export async function submitBookDemo(
  input: BookDemoInput,
): Promise<{ ok: boolean; error?: string }> {
  const { dealershipName, decisionMakerName, phone, email, dealer } = input

  if (!dealershipName.trim())    return { ok: false, error: 'Enter the dealership name.' }
  if (!decisionMakerName.trim()) return { ok: false, error: "Enter the decision maker's name." }
  if (!phone.trim() || phone.replace(/\D/g, '').length < 7)
    return { ok: false, error: 'Enter a valid phone number.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    return { ok: false, error: 'Enter a valid email address.' }

  const submittedAt = new Date()
  const dealership = dealershipName.trim()
  const decisionMaker = decisionMakerName.trim()
  const normalizedEmail = email.trim().toLowerCase()
  const trimmedPhone = phone.trim()
  // Only accept a validated, known dealer slug as attribution (anti-impersonation).
  const dealerSlug = typeof dealer === 'string' && LIVE_DEALER_SLUGS.has(dealer) ? dealer : null

  await db.insert(demoLeads).values({
    dealershipName:    dealership,
    decisionMakerName: decisionMaker,
    phone:             trimmedPhone,
    email:             normalizedEmail,
    status:            'new',
    source:            'dlr_email_book_demo',
    notes:             dealerSlug ? `dealer=${dealerSlug}` : '',
    createdAt:         submittedAt,
    updatedAt:         submittedAt,
  })

  void sendDemoRequestNotification({
    dealershipName: dealership,
    decisionMakerName: decisionMaker,
    phone: trimmedPhone,
    email: normalizedEmail,
    submittedAt,
    dealer: dealerSlug,
  }).catch(err => {
    console.error(
      `[book-demo] Notification failed for ${dealership}:`,
      err instanceof Error ? err.message : String(err),
    )
  })

  void trackEvent('demo_request_submitted', {
    metadata: {
      dealershipName: dealership,
      emailDomain: normalizedEmail.split('@')[1] ?? null,
      dealer: dealerSlug,
    },
  })

  return { ok: true }
}
