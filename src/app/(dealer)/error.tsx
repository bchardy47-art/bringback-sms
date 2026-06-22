'use client'

/**
 * Dealer-facing error boundary.
 *
 * Without this, an unhandled render/data error anywhere under /dealer/**
 * falls back to Next.js's bare default screen — a blank page that reads as
 * "the product crashed" to a first dealer. This renders inside the dealer
 * shell (sidebar + dark theme persist) and gives a calm recovery path:
 * retry, return to the dashboard, or email support. No live-send surface is
 * touched here; it's presentation only.
 */

import { useEffect } from 'react'

export default function DealerError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface to server logs / monitoring so we can see what dealers hit.
    console.error('[dealer] route error:', error)
  }, [error])

  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--pad)',
      }}
    >
      <div
        className="glass"
        style={{ maxWidth: 460, padding: 32, textAlign: 'center' }}
      >
        <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>
          Something went wrong
        </p>
        <h1 className="dlr-headline" style={{ marginTop: 8 }}>
          We hit a snag loading this page
        </h1>
        <p
          style={{
            marginTop: 12,
            fontSize: 14,
            lineHeight: 1.6,
            color: 'var(--tx-mid)',
          }}
        >
          Your data is safe and no messages were affected. Try again, or head
          back to your dashboard.
        </p>

        <div
          style={{
            marginTop: 24,
            display: 'flex',
            gap: 10,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <button onClick={() => reset()} className="dlr-btn-primary">
            Try again
          </button>
          <a
            href="/dealer/dashboard"
            className="dlr-btn-primary"
            style={{ background: 'transparent', border: '1px solid var(--tx-lo)' }}
          >
            Back to dashboard
          </a>
        </div>

        <p style={{ marginTop: 20, fontSize: 12, color: 'var(--tx-lo)' }}>
          Still stuck?{' '}
          <a href="mailto:support@dlr-sms.com" style={{ color: 'var(--tx-mid)' }}>
            Contact DLR support
          </a>
        </p>
      </div>
    </div>
  )
}
