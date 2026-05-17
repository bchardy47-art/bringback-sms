import Stripe from 'stripe'

// Stripe client — DLR/BCHardy LLC is the merchant of record. All charges
// hit our Stripe account. Keys come from env so we don't rotate code when
// keys rotate, and so dev/preview environments can use test keys safely.
//
// stripeOrThrow() throws a clear, message-typed error if STRIPE_SECRET_KEY
// isn't set. Endpoints that need Stripe should call this and translate the
// thrown error into a 503 so the dealer sees "Payment not yet configured —
// continue with billing later" rather than a generic 500.

export class StripeNotConfiguredError extends Error {
  constructor() {
    super('Stripe is not configured (STRIPE_SECRET_KEY missing).')
    this.name = 'StripeNotConfiguredError'
  }
}

let _stripe: Stripe | null = null

export function stripeOrThrow(): Stripe {
  if (_stripe) return _stripe
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new StripeNotConfiguredError()
  _stripe = new Stripe(key, {
    // Pin an API version. Bump deliberately when upgrading.
    apiVersion: '2026-04-22.dahlia',
    appInfo: { name: 'DLR', url: 'https://dlr-sms.com' },
  })
  return _stripe
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

// Plan → Stripe Price ID. Pulled from env so the user can create the
// prices in their Stripe dashboard without touching code.
//   STRIPE_PRICE_PILOT     — Pilot plan recurring price
//   STRIPE_PRICE_STANDARD  — Standard plan recurring price
//   STRIPE_PRICE_PRO       — Pro plan recurring price
export type PlanId = 'pilot' | 'standard' | 'pro'

export function priceIdForPlan(plan: PlanId): string | undefined {
  switch (plan) {
    case 'pilot':    return process.env.STRIPE_PRICE_PILOT
    case 'standard': return process.env.STRIPE_PRICE_STANDARD
    case 'pro':      return process.env.STRIPE_PRICE_PRO
  }
}
