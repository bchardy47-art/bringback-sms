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
}

export async function submitBookDemo(
  input: BookDemoInput,
): Promise<{ ok: boolean; error?: string }> {
  const { dealershipName, decisionMakerName, phone, email } = input

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

  await db.insert(demoLeads).values({
    dealershipName:    dealership,
    decisionMakerName: decisionMaker,
    phone:             trimmedPhone,
    email:             normalizedEmail,
    status:            'new',
    source:            'dlr_email_book_demo',
    notes:             '',
    createdAt:         submittedAt,
    updatedAt:         submittedAt,
  })

  void sendDemoRequestNotification({
    dealershipName: dealership,
    decisionMakerName: decisionMaker,
    phone: trimmedPhone,
    email: normalizedEmail,
    submittedAt,
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
    },
  })

  return { ok: true }
}
