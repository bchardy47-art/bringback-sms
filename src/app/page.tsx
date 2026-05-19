export const metadata = {
  title: 'DLR — Dead Lead Revival | BCHardy LLC',
  description:
    'Dead Lead Revival (DLR) is an SMS re-engagement platform for independent automotive dealerships. ' +
    'We help dealers safely text old internet leads, review every message before launch, and route replies to a human.',
  robots: 'index, follow',
}

// ── Style tokens ────────────────────────────────────────────────────────────
// Inline-style approach kept from the previous homepage — no Tailwind, no
// images beyond /dlr-logo.svg if needed later. Single file, mobile-friendly
// by virtue of max-widths + flex wrapping.

const SYSTEM_FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

const page: React.CSSProperties = {
  minHeight: '100vh',
  margin: 0,
  background: '#fafafa',
  fontFamily: SYSTEM_FONT,
  color: '#111',
  lineHeight: 1.5,
}

const container: React.CSSProperties = {
  maxWidth: 760,
  margin: '0 auto',
  padding: '0 24px',
}

const heroSection: React.CSSProperties = {
  padding: '64px 0 56px',
  textAlign: 'center',
}

const sectionWhite: React.CSSProperties = {
  background: '#fff',
  borderTop: '1px solid #ececec',
  borderBottom: '1px solid #ececec',
  padding: '48px 0',
}

const sectionDefault: React.CSSProperties = {
  padding: '48px 0',
}

const eyebrow: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#888',
  margin: '0 0 16px',
}

const h1: React.CSSProperties = {
  fontSize: 34,
  fontWeight: 700,
  letterSpacing: '-0.02em',
  margin: '0 0 16px',
  lineHeight: 1.2,
}

const lead: React.CSSProperties = {
  fontSize: 17,
  color: '#444',
  margin: '0 auto 12px',
  maxWidth: 600,
}

const subLead: React.CSSProperties = {
  fontSize: 14,
  color: '#666',
  margin: '0 auto 28px',
  maxWidth: 600,
  fontStyle: 'italic',
}

const painParagraph: React.CSSProperties = {
  fontSize: 15,
  color: '#444',
  margin: '0 auto 32px',
  maxWidth: 640,
  lineHeight: 1.65,
}

const h2: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  letterSpacing: '-0.01em',
  margin: '0 0 18px',
}

const p: React.CSSProperties = {
  fontSize: 15,
  color: '#333',
  margin: '0 0 12px',
}

const ctaRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  justifyContent: 'center',
  marginBottom: 18,
}

const btnPrimary: React.CSSProperties = {
  display: 'inline-block',
  background: '#111',
  color: '#fff',
  textDecoration: 'none',
  padding: '12px 22px',
  borderRadius: 10,
  fontSize: 15,
  fontWeight: 600,
}

const btnSecondary: React.CSSProperties = {
  display: 'inline-block',
  background: '#fff',
  color: '#111',
  textDecoration: 'none',
  padding: '12px 22px',
  borderRadius: 10,
  fontSize: 15,
  fontWeight: 600,
  border: '1px solid #d4d4d4',
}

const invitedNote: React.CSSProperties = {
  fontSize: 13,
  color: '#777',
  margin: 0,
}

const stepList: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'grid',
  gap: 12,
}

const stepCard: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 14,
  fontSize: 15,
  color: '#333',
  background: '#fafafa',
  border: '1px solid #ececec',
  borderRadius: 12,
  padding: '14px 16px',
}

const stepNumber: React.CSSProperties = {
  flexShrink: 0,
  width: 26,
  height: 26,
  borderRadius: '50%',
  background: '#111',
  color: '#fff',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 13,
  fontWeight: 700,
  marginTop: 1,
}

const bullets: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'grid',
  gap: 12,
}

const bulletItem: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  fontSize: 15,
  color: '#333',
}

const bulletDot: React.CSSProperties = {
  flexShrink: 0,
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: '#111',
  marginTop: 9,
}

const link: React.CSSProperties = {
  color: '#111',
  textDecoration: 'underline',
}

const trustFootnote: React.CSSProperties = {
  fontSize: 12,
  color: '#888',
  marginTop: 20,
  marginBottom: 0,
}

const footer: React.CSSProperties = {
  borderTop: '1px solid #ececec',
  padding: '24px 0 40px',
  textAlign: 'center',
  fontSize: 12,
  color: '#888',
}

const footerLinks: React.CSSProperties = {
  display: 'inline-flex',
  flexWrap: 'wrap',
  gap: 20,
  justifyContent: 'center',
  marginBottom: 8,
}

const footerLink: React.CSSProperties = {
  color: '#555',
  textDecoration: 'none',
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function RootPage() {
  const year = new Date().getFullYear()

  return (
    <main style={page}>
      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section style={heroSection}>
        <div style={container}>
          <p style={eyebrow}>DLR · Dead Lead Revival · by BCHardy LLC</p>
          <h1 style={h1}>Revive dead dealership leads without adding CRM busywork.</h1>
          <p style={lead}>
            DLR helps independent dealerships safely re-engage old internet leads by SMS,
            review every message before launch, and track replies and results.
          </p>
          <p style={subLead}>
            Built for independent dealers, small rooftops, and stores without giant BDC teams.
          </p>

          <nav aria-label="Sign in" style={ctaRow}>
            <a href="/login?callbackUrl=%2Fdealer%2Fdashboard" style={btnPrimary}>
              Dealer Sign In →
            </a>
            <a href="/login?callbackUrl=%2Fdashboard" style={btnSecondary}>
              Admin / Team Sign In
            </a>
          </nav>

          <p style={invitedNote}>
            Already invited by DLR? Use the link Brian sent you to finish setup.
          </p>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────── */}
      <section style={sectionWhite}>
        <div style={container}>
          <p style={painParagraph}>
            Most dealerships have thousands of old leads sitting in the CRM untouched.
            DLR helps bring those conversations back to life without forcing your team
            into another complicated software workflow.
          </p>
          <h2 style={h2}>How it works</h2>
          <ol style={stepList}>
            {[
              'You upload your prior dealership leads (CSV from your CRM).',
              'DLR groups them by age — recent follow-ups vs. long-cold revivals.',
              'You review the exact message previews for every lead before anything sends.',
              'We walk you through the 10DLC compliance setup with the carriers.',
              'Hot replies land in your inbox so a salesperson can take over the conversation.',
            ].map((text, i) => (
              <li key={i} style={stepCard}>
                <span style={stepNumber}>{i + 1}</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Trust / Safety ─────────────────────────────────────────────── */}
      <section style={sectionDefault}>
        <div style={container}>
          <h2 style={h2}>Built for dealership compliance</h2>
          <ul style={bullets}>
            {[
              <>
                <strong>Guided 10DLC setup.</strong>{' '}
                We help you submit brand and campaign registration through the carrier portal.
              </>,
              <>
                <strong>Automatic STOP / HELP handling.</strong>{' '}
                The platform honours opt-outs and replies to HELP requests on every send.
              </>,
              <>
                <strong>You approve every message.</strong>{' '}
                Nothing is sent until you’ve reviewed the previews and approved the batch.
              </>,
              <>
                <strong>Quiet hours, rate limits, and pause controls.</strong>{' '}
                Per-tenant controls keep sends inside business hours and stoppable in one click.
              </>,
              <>
                <strong>Your dealership owns its customer data.</strong>{' '}
                We don’t share or resell lead lists. You can export your data anytime.
              </>,
            ].map((node, i) => (
              <li key={i} style={bulletItem}>
                <span style={bulletDot} />
                <span>{node}</span>
              </li>
            ))}
          </ul>
          <p style={trustFootnote}>
            No long-term contracts. Dealer approval required before launch.
          </p>
        </div>
      </section>

      {/* ── Who runs DLR ───────────────────────────────────────────────── */}
      <section style={sectionWhite}>
        <div style={container}>
          <h2 style={h2}>Who runs DLR</h2>
          <p style={p}>
            DLR is operated by <strong>BCHardy LLC</strong> in Saratoga Springs, Utah.
            We’re a small independent operator — when something breaks, you reach a real
            person directly.
          </p>
          <p style={p}>
            You will always know what messages are being sent under your dealership’s name.
          </p>
          <p style={p}>
            Questions, setup help, or anything compliance-related:{' '}
            <a href="mailto:support@dlr-sms.com" style={link}>support@dlr-sms.com</a>
          </p>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer style={footer}>
        <div style={container}>
          <div style={footerLinks}>
            <a href="/privacy"   style={footerLink}>Privacy</a>
            <a href="/terms"     style={footerLink}>Terms</a>
            <a href="/sms-terms" style={footerLink}>SMS Terms</a>
          </div>
          <div>© {year} BCHardy LLC · Saratoga Springs, Utah</div>
        </div>
      </footer>
    </main>
  )
}
