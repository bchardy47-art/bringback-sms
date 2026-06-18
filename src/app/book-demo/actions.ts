'use server'

import { db } from '@/lib/db'
import { demoLeads } from '@/lib/db/schema'

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

  await db.insert(demoLeads).values({
    dealershipName:    dealershipName.trim(),
    decisionMakerName: decisionMakerName.trim(),
    phone:             phone.trim(),
    email:             email.trim().toLowerCase(),
    status:            'new',
    source:            'dlr_email_book_demo',
    notes:             '',
  })

  return { ok: true }
}
