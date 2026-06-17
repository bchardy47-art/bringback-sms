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
    <div className="space-y-3">
      {paymentStatus && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span style={{ color: 'var(--tx-lo)' }}>Subscription status:</span>
          <StatusBadge status={paymentStatus} />
        </div>
      )}

      {hasCustomer ? (
        <>
          <p style={{ fontSize: 13, color: 'var(--tx-mid)', lineHeight: 1.55 }}>
            Update your payment method, download invoices, or cancel your subscription
            from the secure Stripe billing portal.
          </p>
          <button
            type="button"
            onClick={openPortal}
            disabled={busy}
            className="dlr-btn-secondary"
            style={{ height: 38, fontSize: 13 }}
          >
            <CreditCard size={14} />
            {busy ? 'Opening portal…' : 'Manage billing in Stripe'}
            <ExternalLink size={13} />
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <p style={{ fontSize: 13, color: 'var(--tx-mid)', lineHeight: 1.55 }}>
            Payment is not required during your pilot. Your DLR team will walk
            you through activation when you are ready to launch.
          </p>
          <p style={{ fontSize: 13, color: 'var(--tx-mid)', lineHeight: 1.55 }}>
            Contact{' '}
            <a
              href="mailto:support@dlr-sms.com"
              style={{ fontWeight: 600, color: 'var(--tx-hi)', textDecoration: 'underline' }}
            >
              support@dlr-sms.com
            </a>{' '}
            with any billing questions.
          </p>
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            borderRadius: 8, padding: '9px 12px', fontSize: 13,
            border: '1px solid rgba(255,80,80,0.3)',
            background: 'rgba(255,42,42,0.08)',
            color: '#ff8a7a',
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    paid:            { label: 'Active',           bg: 'rgba(34,197,94,0.12)',   fg: '#4ade80' },
    awaiting_stripe: { label: 'Awaiting payment', bg: 'rgba(245,158,11,0.12)',  fg: '#fbbf24' },
    past_due:        { label: 'Past due',         bg: 'rgba(255,42,42,0.12)',   fg: '#ff8a7a' },
    cancelled:       { label: 'Cancelled',        bg: 'rgba(255,255,255,0.05)', fg: 'var(--tx-lo)' },
    skipped:         { label: 'Billing later',    bg: 'rgba(255,255,255,0.05)', fg: 'var(--tx-lo)' },
    pending:         { label: 'Pending',          bg: 'rgba(255,255,255,0.05)', fg: 'var(--tx-lo)' },
  }
  const info = map[status] ?? { label: status, bg: 'rgba(255,255,255,0.05)', fg: 'var(--tx-lo)' }
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center',
        borderRadius: 20, padding: '2px 9px',
        fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
        backgroundColor: info.bg, color: info.fg,
      }}
    >
      {info.label}
    </span>
  )
}
