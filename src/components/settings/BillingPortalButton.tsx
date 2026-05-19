'use client'

import { useState } from 'react'
import { CreditCard, ExternalLink } from 'lucide-react'

// Opens the Stripe-hosted Billing Portal in a top-level navigation.
//
// Server props:
//   hasCustomer  — whether the user's tenant has a stripe_customer_id.
//                  Determined at SSR time in the settings page. When
//                  false we render an inert "No billing on file" panel
//                  instead of an enabled button — same component, two
//                  states, so the section always renders and pages don't
//                  flicker.
//   paymentStatus — current payment status from dealer_intakes; surfaced
//                  as a small badge above the button so the dealer sees
//                  state at a glance.
//   recoveryHref — when !hasCustomer, deep-link to /intake/<token>/payment
//                  so the dealer has a one-click recovery path back into
//                  the payment step instead of a dead-end message. Null
//                  if no intake row exists for the tenant, in which case
//                  we render a support-contact fallback.
export function BillingPortalButton({
  hasCustomer,
  paymentStatus,
  recoveryHref,
}: {
  hasCustomer:   boolean
  paymentStatus?: string | null
  recoveryHref?:  string | null
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function openPortal() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Empty body — endpoint picks a role-appropriate return path.
        body: '{}',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error ?? 'Could not open billing portal.')
      }
      if (!data?.url) {
        throw new Error('Stripe did not return a portal URL.')
      }
      window.location.href = data.url as string
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <div className="px-6 py-5 space-y-3">
      {paymentStatus && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Subscription status:</span>
          <StatusBadge status={paymentStatus} />
        </div>
      )}

      {hasCustomer ? (
        <>
          <p className="text-sm text-gray-600">
            Update your payment method, download invoices, or cancel your subscription
            from the secure Stripe billing portal.
          </p>
          <button
            type="button"
            onClick={openPortal}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          >
            <CreditCard size={15} />
            {busy ? 'Opening portal…' : 'Manage billing in Stripe'}
            <ExternalLink size={13} />
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-gray-900">
            No payment method is on file yet.
          </p>
          <p className="text-sm text-gray-600">
            Add a payment method so DLR can continue carrier setup, number
            assignment, and pilot preparation.
          </p>
          {recoveryHref ? (
            <a
              href={recoveryHref}
              className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
            >
              <CreditCard size={15} />
              Finish payment setup
              <span aria-hidden="true">→</span>
            </a>
          ) : (
            <p className="text-sm text-gray-600">
              Contact{' '}
              <a
                href="mailto:support@dlr-sms.com"
                className="font-semibold text-gray-900 underline hover:text-gray-700"
              >
                support@dlr-sms.com
              </a>{' '}
              and we&apos;ll resend your activation link.
            </p>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    paid:            { label: 'Active',          bg: '#dcfce7', fg: '#166534' },
    awaiting_stripe: { label: 'Awaiting payment',bg: '#fef3c7', fg: '#92400e' },
    past_due:        { label: 'Past due',        bg: '#fee2e2', fg: '#991b1b' },
    cancelled:       { label: 'Cancelled',       bg: '#f3f4f6', fg: '#4b5563' },
    skipped:         { label: 'Billing later',   bg: '#f3f4f6', fg: '#4b5563' },
    pending:         { label: 'Pending',         bg: '#f3f4f6', fg: '#4b5563' },
  }
  const info = map[status] ?? { label: status, bg: '#f3f4f6', fg: '#4b5563' }
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: info.bg, color: info.fg }}
    >
      {info.label}
    </span>
  )
}
