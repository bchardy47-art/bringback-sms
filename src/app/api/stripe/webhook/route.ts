import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { db } from '@/lib/db'
import { dealerIntakes } from '@/lib/db/schema'
import { isStripeConfigured, stripeOrThrow } from '@/lib/stripe'

// POST /api/stripe/webhook
//
// Stripe-signed event handler for subscription lifecycle. The hosted
// Checkout success redirect handles the happy path; this endpoint covers
// the async / unhappy paths Stripe sends out-of-band:
//
//   checkout.session.completed   → safety-net for the happy path in case
//                                   the dealer closed the success tab
//                                   before our verification ran
//   invoice.payment_failed       → renewal payment failed (recoverable)
//   customer.subscription.deleted→ subscription terminated (terminal)
//
// Auth: Stripe signs the request body with STRIPE_WEBHOOK_SECRET. We
// recompute the signature here; mismatched → 400 (and Stripe stops
// retrying with the same secret).
//
// Idempotency: Stripe retries on non-2xx for up to 3 days. Our handlers
// are idempotent — every write is an UPDATE on the row identified by a
// Stripe id, and payment_status transitions are guarded so a late
// invoice.payment_failed cannot regress a row from 'cancelled'.

// Webhook bodies must be read raw — Next App Router has no global JSON
// body parser, so req.text() gives us the unparsed bytes that
// stripe.webhooks.constructEvent expects.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return new NextResponse('Stripe not configured', { status: 503 })
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    return new NextResponse('Webhook secret not configured', { status: 503 })
  }

  const sig = req.headers.get('stripe-signature')
  if (!sig) {
    return new NextResponse('Missing stripe-signature header', { status: 400 })
  }

  const rawBody = await req.text()

  let event: Stripe.Event
  try {
    const stripe = stripeOrThrow()
    event = stripe.webhooks.constructEvent(rawBody, sig, secret)
  } catch (err) {
    // Don't echo body or signature. Just log the failure mode.
    console.error('[stripe webhook] signature verification failed:', (err as Error).message)
    return new NextResponse('Invalid signature', { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
        break
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice)
        break
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break
      // 'invoice.payment_succeeded' deliberately not handled — once paid,
      // the row stays paid; if we ever care about next-period-end we can
      // start writing that here. Unrecognized event types are not errors;
      // Stripe sends many we don't subscribe to. Returning 200 below.
    }
  } catch (err) {
    // Return 500 so Stripe retries with backoff. The handler is idempotent.
    console.error(`[stripe webhook] ${event.type} handler error:`, err)
    return new NextResponse('Handler error', { status: 500 })
  }

  return NextResponse.json({ received: true, type: event.type })
}

// ── Handlers ─────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const token =
    session.client_reference_id ??
    (session.metadata?.token as string | undefined) ??
    null
  const customerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null
  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id ?? null

  // Locate the intake. Prefer the token (single-source-of-truth, set on
  // session creation); fall back to the session id we previously stored.
  let intake = token
    ? await db.query.dealerIntakes.findFirst({
        where: eq(dealerIntakes.token, token),
      })
    : null
  if (!intake) {
    intake = await db.query.dealerIntakes.findFirst({
      where: eq(dealerIntakes.stripeCheckoutSessionId, session.id),
    })
  }
  if (!intake) {
    console.warn('[stripe webhook] checkout.session.completed: no intake matched', {
      sessionId: session.id,
      token,
    })
    return
  }

  await db
    .update(dealerIntakes)
    .set({
      paymentStatus: 'paid',
      stripeCustomerId: customerId ?? intake.stripeCustomerId,
      stripeSubscriptionId: subscriptionId ?? intake.stripeSubscriptionId,
      stripeCheckoutSessionId: session.id,
      updatedAt: new Date(),
    })
    .where(eq(dealerIntakes.id, intake.id))
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId =
    typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null
  if (!customerId) return

  const intake = await db.query.dealerIntakes.findFirst({
    where: eq(dealerIntakes.stripeCustomerId, customerId),
  })
  if (!intake) {
    console.warn('[stripe webhook] invoice.payment_failed: no intake for customer', customerId)
    return
  }

  // State guard: don't regress a terminated subscription back to past_due
  // if an old failed-invoice event arrives late. 'cancelled' and 'skipped'
  // are sticky terminals from this path's perspective.
  if (intake.paymentStatus === 'cancelled' || intake.paymentStatus === 'skipped') return

  await db
    .update(dealerIntakes)
    .set({
      paymentStatus: 'past_due',
      updatedAt: new Date(),
    })
    .where(eq(dealerIntakes.id, intake.id))
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const intake = await db.query.dealerIntakes.findFirst({
    where: eq(dealerIntakes.stripeSubscriptionId, subscription.id),
  })
  if (!intake) {
    console.warn(
      '[stripe webhook] customer.subscription.deleted: no intake for subscription',
      subscription.id,
    )
    return
  }
  await db
    .update(dealerIntakes)
    .set({
      paymentStatus: 'cancelled',
      updatedAt: new Date(),
    })
    .where(eq(dealerIntakes.id, intake.id))
}
