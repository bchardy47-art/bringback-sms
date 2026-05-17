import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dealerIntakes } from '@/lib/db/schema'
import {
  isStripeConfigured,
  priceIdForPlan,
  stripeOrThrow,
  type PlanId,
} from '@/lib/stripe'

// POST /api/intake/[token]/checkout
//
// Creates a Stripe Checkout Session for the dealer's chosen plan and
// returns { url } for the client to redirect to.
//
// Preconditions:
//   - intake row exists for the token
//   - activatedAt is set (no checkout before activation)
//   - termsAcceptedAt is set (no checkout without legal acceptance)
//
// If Stripe isn't configured (no STRIPE_SECRET_KEY in env) we return 503
// with a clear message so the client can show "Payment not yet configured"
// without falling back to a generic 500.

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
      return NextResponse.json({ error: 'Complete activation first.' }, { status: 409 })
    }
    if (!intake.termsAcceptedAt) {
      return NextResponse.json(
        { error: 'Terms acceptance is required before payment.' },
        { status: 409 },
      )
    }

    if (!isStripeConfigured()) {
      return NextResponse.json(
        { error: 'Payment is not configured yet. Please choose "billing later".' },
        { status: 503 },
      )
    }

    const planRaw = intake.plan ?? 'pilot'
    if (planRaw !== 'pilot' && planRaw !== 'standard' && planRaw !== 'pro') {
      return NextResponse.json({ error: 'Invalid plan on this intake.' }, { status: 422 })
    }
    const plan = planRaw as PlanId

    const priceId = priceIdForPlan(plan)
    if (!priceId) {
      return NextResponse.json(
        { error: `No Stripe price configured for plan "${plan}".` },
        { status: 503 },
      )
    }

    const stripe = stripeOrThrow()

    // Origin used for return URLs. NEXTAUTH_URL is already set to the
    // app origin (https://dlr-sms.com) — reuse it instead of inferring
    // from the request, since middleware/redirects can rewrite host.
    const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? new URL(req.url).origin

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      // Pre-fill email and link to a Stripe Customer if we already have one;
      // otherwise Stripe will create one and we capture the id at success.
      ...(intake.stripeCustomerId
        ? { customer: intake.stripeCustomerId }
        : { customer_email: intake.primaryContactEmail ?? undefined }),
      // Stripe needs a way to identify this intake on the success callback.
      // We use the token (public, single-use) since the success page also
      // looks up by token.
      client_reference_id: intake.token,
      metadata: {
        intakeId: intake.id,
        token: intake.token,
        plan,
      },
      subscription_data: {
        metadata: {
          intakeId: intake.id,
          token: intake.token,
          plan,
        },
      },
      success_url: `${baseUrl}/intake/${intake.token}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${baseUrl}/intake/${intake.token}/payment?cancelled=1`,
      allow_promotion_codes: true,
    })

    // Record the session id so admins can correlate even before success.
    await db
      .update(dealerIntakes)
      .set({
        stripeCheckoutSessionId: session.id,
        paymentStatus: 'awaiting_stripe',
        updatedAt: new Date(),
      })
      .where(eq(dealerIntakes.id, intake.id))

    if (!session.url) {
      return NextResponse.json(
        { error: 'Stripe did not return a checkout URL.' },
        { status: 502 },
      )
    }
    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('[intake checkout POST]', err)
    return NextResponse.json({ error: 'Could not start checkout.' }, { status: 500 })
  }
}
