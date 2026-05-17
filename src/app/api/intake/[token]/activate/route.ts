import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { dealerIntakes } from '@/lib/db/schema'

// Stage 1 — Activation/Close endpoint.
//   Minimum payload to lock the deal: identity, contact, terms, plan.
//   Returns ok on success. The page then routes to the payment step.
//
// We intentionally write to the same dealer_intakes row as the existing
// long-form intake so admins see a single record per deal — Stage 1
// fills the "must-have" fields, Stage 2 fills the rest.

const ActivationSchema = z.object({
  dealershipName: z.string().trim().min(1, 'Dealership name is required').max(200),
  contactName:    z.string().trim().min(1, 'Your name is required').max(200),
  contactEmail:   z.string().trim().email('Valid email is required').max(200),
  contactMobile:  z
    .string()
    .trim()
    .min(7, 'Mobile is required')
    .max(40)
    .regex(/^[\d\s()+\-.]+$/, 'Mobile contains invalid characters'),
  website:        z.string().trim().url('Website must be a full URL').max(500),
  storeAddress:   z.string().trim().min(5, 'Store address is required').max(500),
  crmSystem:      z.string().trim().max(100).optional().nullable(),
  plan:           z.enum(['pilot', 'standard', 'pro']),
  termsAgreed:    z.union([z.literal('true'), z.literal(true), z.literal('on')]),
  // Sent by the client so we record which version of /terms the dealer
  // saw at the moment of acceptance. Falls back to 'unknown' if missing,
  // so legacy/replay submits don't crash.
  termsVersion:   z.string().trim().max(40).optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  try {
    const intake = await db.query.dealerIntakes.findFirst({
      where: eq(dealerIntakes.token, params.token),
    })
    if (!intake) {
      return NextResponse.json({ error: 'Invalid intake link.' }, { status: 404 })
    }
    if (intake.submittedAt) {
      return NextResponse.json(
        { error: 'This intake has already been completed.' },
        { status: 409 },
      )
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = ActivationSchema.safeParse(body)
    if (!parsed.success) {
      const first = parsed.error.errors[0]?.message ?? 'Please check the fields and try again.'
      return NextResponse.json({ error: first }, { status: 422 })
    }
    const d = parsed.data

    await db
      .update(dealerIntakes)
      .set({
        // Identity (Stage 1 minimum)
        dealershipName:      d.dealershipName,
        businessWebsite:     d.website,
        businessAddress:     d.storeAddress,

        // Contact (Stage 1 minimum). We map the single contact across both
        // primary-contact and alert-phone slots so revival alerts work
        // immediately; the dealer can split these in Stage 2.
        primaryContactName:  d.contactName,
        primaryContactEmail: d.contactEmail,
        primaryContactPhone: d.contactMobile,
        alertPhone:          d.contactMobile,
        alertEmail:          d.contactEmail,

        // Operations hint (optional)
        crmSystem:           d.crmSystem || undefined,

        // Stage 1 outcome
        plan:                d.plan,
        activatedAt:         new Date(),
        // Legal acceptance audit trail. complianceAgreed is the long-
        // standing flag the rest of the app reads; termsAcceptedAt +
        // termsVersion are the new, version-aware record of what the
        // dealer actually saw at /terms when they clicked Activate.
        complianceAgreed:    true,
        termsAcceptedAt:     new Date(),
        termsVersion:        d.termsVersion ?? 'unknown',
        // Status reflects activation (deal closed); Stage 2 will move it
        // forward through info_complete / 10dlc_* / provisioned.
        launchStatus:        'activated',
        updatedAt:           new Date(),
      })
      .where(eq(dealerIntakes.id, intake.id))

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[intake activate POST]', err)
    return NextResponse.json({ error: 'Server error. Please try again.' }, { status: 500 })
  }
}
