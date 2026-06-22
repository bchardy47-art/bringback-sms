/**
 * Dealer-facing 404.
 *
 * Replaces Next.js's unstyled default for any /dealer/** path that doesn't
 * resolve (e.g. a stale bookmark, a deleted conversation, or a mistyped
 * URL during a demo). Renders inside the dealer shell and points back to
 * the dashboard or support. Presentation only — no data or send logic.
 */

export default function DealerNotFound() {
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
        <p className="dlr-cmd-label" style={{ color: '#fbbf24' }}>
          Page not found
        </p>
        <h1 className="dlr-headline" style={{ marginTop: 8 }}>
          We couldn&apos;t find that page
        </h1>
        <p
          style={{
            marginTop: 12,
            fontSize: 14,
            lineHeight: 1.6,
            color: 'var(--tx-mid)',
          }}
        >
          This page may have moved, or the link is no longer valid. Let&apos;s get
          you back on track.
        </p>

        <div style={{ marginTop: 24 }}>
          <a href="/dealer/dashboard" className="dlr-btn-primary">
            Back to dashboard
          </a>
        </div>

        <p style={{ marginTop: 20, fontSize: 12, color: 'var(--tx-lo)' }}>
          Think this is a mistake?{' '}
          <a href="mailto:support@dlr-sms.com" style={{ color: 'var(--tx-mid)' }}>
            Contact DLR support
          </a>
        </p>
      </div>
    </div>
  )
}
