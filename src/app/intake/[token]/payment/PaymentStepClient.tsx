'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const PLAN_LABEL: Record<string, string> = {
  pilot: 'Pilot',
  standard: 'Standard',
  pro: 'Pro',
}

export function PaymentStepClient({
  token,
  plan,
  paymentStatus,
}: {
  token: string
  plan: string
  paymentStatus: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<'stripe' | 'skip' | null>(null)
  const [error, setError] = useState('')

  // Mark payment as deferred and continue to Stage 2. Used by the
  // "Continue to setup — I'll handle billing with our rep" path.
  async function skipForNow() {
    setBusy('skip')
    setError('')
    try {
      const res = await fetch(`/api/intake/${token}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'skip' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Could not save. Please try again.')
      }
      router.replace(`/intake/${token}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(null)
    }
  }

  // Real Stripe Checkout. POSTs to our checkout endpoint, which creates
  // a Checkout Session on our Stripe account and returns the hosted URL.
  // If Stripe keys aren't configured yet, the endpoint returns 503 with a
  // user-friendly message; we surface it as an inline error rather than
  // a generic failure so the dealer can still hit "billing later".
  async function startCheckout() {
    setBusy('stripe')
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
      // Top-level navigation to Stripe's hosted Checkout. We don't use
      // router.replace because the destination is off-origin.
      window.location.href = body.url as string
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(null)
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
            <p className="text-sm text-emerald-800">Payment already on file — you're all set.</p>
          </div>
        )}

        <p className="text-sm text-gray-600 mb-2">
          Activation is complete. Add your payment method to reserve your plan —{' '}
          <strong className="font-semibold text-gray-800">
            card goes on file now; the first charge starts when your campaign is approved
            and live with the carriers
          </strong>{' '}
          (typically 7–10 business days). Or continue to setup and we&apos;ll arrange
          billing with you directly.
        </p>
        <p className="text-xs text-gray-500 mb-5">
          Note: Stripe&apos;s checkout page labels this wait as a &ldquo;14-day trial.&rdquo;
          That&apos;s how Stripe describes the billing-delay window — it&apos;s the same
          thing, not a separate offer.
        </p>

        <div className="space-y-2">
          <button
            type="button"
            onClick={startCheckout}
            disabled={busy !== null}
            className="w-full py-3 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-60"
            style={{ backgroundColor: '#dc2626' }}
          >
            {busy === 'stripe' ? 'Opening checkout…' : 'Add payment method →'}
          </button>
          <button
            type="button"
            onClick={skipForNow}
            disabled={busy !== null}
            className="w-full py-3 rounded-xl text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors disabled:opacity-60"
          >
            {busy === 'skip' ? 'Continuing…' : 'Continue to setup — billing later'}
          </button>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 mt-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 text-center px-4">
        Secure payment processing will be handled by Stripe. We never store card numbers.
      </p>
    </div>
  )
}
