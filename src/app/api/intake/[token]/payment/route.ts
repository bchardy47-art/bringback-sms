import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { dealerIntakes } from '@/lib/db/schema'

// Stage 1.5 — Payment step endpoint.
//   Records the dealer's payment intent. Stripe is not wired yet (no
//   API keys); when it is, the 'start_checkout' branch will create a
//   Stripe Checkout Session and return the URL for the client to redirect
//   to. For now it just marks the intake so an admin can complete billing
//   out-of-band.

const PaymentSchema = z.object({
  action: z.enum(['skip', 'start_checkout']),
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
    if (!intake.activatedAt) {
      return NextResponse.json(
        { error: 'Complete activation before payment.' },
        { status: 409 },
      )
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = PaymentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 422 })
    }

    const paymentStatus =
      parsed.data.action === 'skip' ? 'skipped' : 'awaiting_stripe'

    await db
      .update(dealerIntakes)
      .set({ paymentStatus, updatedAt: new Date() })
      .where(eq(dealerIntakes.id, intake.id))

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[intake payment POST]', err)
    return NextResponse.json({ error: 'Server error. Please try again.' }, { status: 500 })
  }
}
