'use client'

import { useState } from 'react'

const PLAN_LABEL: Record<string, string> = {
  pilot: 'Pilot',
  standard: 'Standard',
  pro: 'Pro',
}

// Self-serve payment step. Only one forward path: Stripe Checkout.
//
// The prior "Continue to setup — billing later" button was removed
// because it let any dealer mark payment_status='skipped' and slip into
// Stage 2 without billing on file. Out-of-band billing is still
// supported, but only via an admin setting payment_status='manual_billing'
// on the row directly (SQL or future admin action), not via a
// dealer-facing button. See the state-machine comment in
// /intake/[token]/page.tsx.
export function PaymentStepClient({
  token,
  plan,
  paymentStatus,
}: {
  token: string
  plan: string
  paymentStatus: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Real Stripe Checkout. POSTs to our checkout endpoint, which creates
  // a Checkout Session on our Stripe account and returns the hosted URL.
  // If Stripe keys aren't configured yet, the endpoint returns 503 with
  // a user-friendly message; we surface it as an inline error.
  async function startCheckout() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/intake/${token}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body?.error ?? 'Could not start checkout.')
      }
      if (!body?.url) {
        throw new Error('Stripe did not return a checkout URL.')
      }
      // Top-level navigation to Stripe's hosted Checkout. Don't use
      // router.replace — destination is off-origin.
      window.location.href = body.url as string
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  const planLabel = PLAN_LABEL[plan] ?? plan

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider">Your plan</p>
            <p className="text-lg font-bold text-gray-900 mt-0.5">{planLabel}</p>
          </div>
          <a
            href={`/intake/${token}`}
            className="text-xs text-gray-500 underline hover:text-gray-700"
          >
            Change
          </a>
        </div>

        {paymentStatus === 'paid' && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 mb-4">
            <p className="text-sm text-emerald-800">Payment already on file — you&apos;re all set.</p>
          </div>
        )}

        <p className="text-sm text-gray-600 mb-2">
          Activation is complete. Add your payment method to reserve your plan —{' '}
          <strong className="font-semibold text-gray-800">
            card goes on file now; the first charge starts when your campaign is approved
            and live with the carriers
          </strong>{' '}
          (typically 7–10 business days).
        </p>
        <p className="text-xs text-gray-500 mb-4">
          Note: Stripe&apos;s checkout page labels this wait as a &ldquo;14-day trial.&rdquo;
          That&apos;s how Stripe describes the billing-delay window — it&apos;s the same
          thing, not a separate offer.
        </p>

        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 mb-5">
          <p className="text-sm text-amber-900">
            <span className="font-semibold">Heads up:</span> after checkout,
            you&apos;ll complete a setup form. Have your legal business name
            and EIN handy.
          </p>
        </div>

        <button
          type="button"
          onClick={startCheckout}
          disabled={busy}
          className="w-full py-3 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-60"
          style={{ backgroundColor: '#dc2626' }}
        >
          {busy ? 'Opening checkout…' : 'Add payment method →'}
        </button>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 mt-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 text-center px-4">
        Need a custom billing arrangement? Reach out to support — we&apos;ll set you up
        manually. Otherwise, complete payment to continue your setup.
      </p>

      <p className="text-xs text-gray-400 text-center px-4">
        Secure payment processing handled by Stripe. We never store card numbers.
      </p>
    </div>
  )
}
