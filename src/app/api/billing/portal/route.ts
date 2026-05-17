import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/api/requireAuth'
import { isStripeConfigured, stripeOrThrow } from '@/lib/stripe'
import { getStripeCustomerIdForTenant } from '@/lib/billing'

// POST /api/billing/portal
//
// Creates a Stripe-hosted Billing Portal session for the authenticated
// user's tenant. The portal is where dealers update their payment method,
// view invoices, and cancel the subscription. We don't render any of that
// ourselves — Stripe owns the UI, we just point the dealer at it.
//
// Auth: requireAuth — any signed-in user (admin or dealer). The lookup
// is by tenant, so the user only ever sees their own tenant's customer.
//
// Resolution: session.user.tenantId → dealer_intakes.tenant_id → stripe_customer_id.
// If the tenant has no customer yet (no completed Checkout), returns 404
// with a clear "No billing on file" message so the UI can render an
// inert state rather than a broken button.

const BodySchema = z.object({
  // Optional caller-supplied return target. Must be a same-origin
  // relative path (open-redirect guard). Defaults are per-role below.
  returnPath: z
    .string()
    .max(200)
    .startsWith('/')
    .refine((p) => !p.startsWith('//'), 'Must be same-origin')
    .optional(),
})

export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth()
  if (error) return error

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: 'Billing is not configured yet.' },
      { status: 503 },
    )
  }

  let body: unknown = {}
  // Body is optional — accept empty payloads as the common case (button click).
  if (req.headers.get('content-length') && req.headers.get('content-length') !== '0') {
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
  }
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid returnPath' }, { status: 422 })
  }

  const customerId = await getStripeCustomerIdForTenant(session.user.tenantId)
  if (!customerId) {
    return NextResponse.json(
      { error: 'No billing on file for this account.' },
      { status: 404 },
    )
  }

  const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? new URL(req.url).origin
  const defaultReturnPath = session.user.role === 'dealer' ? '/dealer/settings' : '/settings'
  const returnUrl = `${baseUrl}${parsed.data.returnPath ?? defaultReturnPath}`

  try {
    const stripe = stripeOrThrow()
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    })
    return NextResponse.json({ url: portal.url })
  } catch (err) {
    // The most common failure mode here is a Stripe-side configuration
    // error (the dashboard's Billing → Customer portal hasn't been set up
    // yet). Surface the Stripe message so it's diagnosable from the
    // browser console without exposing internals.
    const message = err instanceof Error ? err.message : 'Could not start billing portal.'
    console.error('[billing portal POST]', message)
    return NextResponse.json(
      { error: `Could not start billing portal: ${message}` },
      { status: 502 },
    )
  }
}
