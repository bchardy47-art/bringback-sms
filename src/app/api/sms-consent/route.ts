/**
 * POST /api/sms-consent
 *
 * Public web-form endpoint for SMS opt-in. Persists a durable, append-only
 * `sms_consent_events` record so we can prove consent to carriers / in a
 * TCPA dispute.
 *
 * Tenant resolution:
 *   - Body may include `tenantSlug` (preferred), otherwise falls back to the
 *     env var SMS_CONSENT_DEFAULT_TENANT_SLUG.
 *   - The endpoint NEVER trusts a raw tenantId from the client.
 *
 * Required: firstName, lastName, phone, smsConsent === true, consentTextVersion.
 * Optional: email, vehicleOfInterest.
 *
 * On success the response includes only an opaque `consentId`. We do not echo
 * back tenant or lead identifiers.
 */

import { NextRequest, NextResponse } from 'next/server'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { smsConsentEvents, tenants } from '@/lib/db/schema'

const Body = z.object({
  firstName:           z.string().min(1).max(200),
  lastName:            z.string().min(1).max(200),
  phone:               z.string().min(7).max(30),
  email:               z.string().email().max(320).optional(),
  vehicleOfInterest:   z.string().max(500).optional(),
  smsConsent:          z.literal(true),
  consentTextVersion:  z.string().min(1).max(50),
  consentTextSnapshot: z.string().min(20).max(4000),
  tenantSlug:          z.string().min(1).max(100).optional(),
  pageUrl:             z.string().max(2000).optional(),
})

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]?.trim() ?? null
  return req.headers.get('x-real-ip') ?? null
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = Body.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid submission', issues: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const e164 = parsePhoneNumberFromString(parsed.data.phone, 'US')
  if (!e164 || !e164.isValid()) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 422 })
  }
  const phone = e164.number   // E.164

  const slug =
    parsed.data.tenantSlug ?? process.env.SMS_CONSENT_DEFAULT_TENANT_SLUG ?? null
  if (!slug) {
    return NextResponse.json(
      { error: 'No tenant configured for consent capture' },
      { status: 500 },
    )
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.slug, slug),
    columns: { id: true },
  })
  if (!tenant) {
    return NextResponse.json({ error: 'Unknown tenant' }, { status: 404 })
  }

  const [row] = await db
    .insert(smsConsentEvents)
    .values({
      tenantId:            tenant.id,
      phone,
      firstName:           parsed.data.firstName.trim(),
      lastName:            parsed.data.lastName.trim(),
      email:               parsed.data.email?.trim(),
      vehicleOfInterest:   parsed.data.vehicleOfInterest?.trim(),
      source:              'web_form',
      consentTextVersion:  parsed.data.consentTextVersion,
      consentTextSnapshot: parsed.data.consentTextSnapshot,
      ipAddress:           clientIp(req),
      userAgent:           req.headers.get('user-agent'),
      pageUrl:             parsed.data.pageUrl,
    })
    .returning({ id: smsConsentEvents.id })

  return NextResponse.json({ consentId: row.id }, { status: 201 })
}
