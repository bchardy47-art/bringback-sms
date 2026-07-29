import { BookDemoForm } from '../book-demo/BookDemoForm'

// Public, GENERIC pilot-offer page. Does NOT name or characterize any specific
// dealership, so it is safe to index and deploy publicly.
export const metadata = {
  title: 'Utah AI Lead Revival Challenge — DLR',
  description:
    'DLR is selecting one Utah dealership for a free, controlled AI lead-revival pilot. ' +
    'Provide 25–50 old, consented leads, approve every message, and keep every buyer conversation and sale.',
  robots: 'index, follow',
}

const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const RED = '#e23b3b'
const INK = '#0b0b0d'

const page: React.CSSProperties = { minHeight: '100vh', margin: 0, background: INK, color: '#f5f5f7', fontFamily: FONT, lineHeight: 1.55 }
const wrap: React.CSSProperties = { maxWidth: 820, margin: '0 auto', padding: '0 24px' }
const card: React.CSSProperties = { background: '#141418', border: '1px solid #26262c', borderRadius: 14, padding: '28px 26px', margin: '18px 0' }
const cta: React.CSSProperties = { display: 'inline-block', background: RED, color: '#fff', fontWeight: 700, padding: '14px 26px', borderRadius: 10, textDecoration: 'none' }
const ctaGhost: React.CSSProperties = { display: 'inline-block', color: '#f5f5f7', fontWeight: 600, padding: '14px 22px', borderRadius: 10, textDecoration: 'none', border: '1px solid #3a3a42' }
const h2: React.CSSProperties = { fontSize: 22, fontWeight: 800, margin: '0 0 12px' }
const li: React.CSSProperties = { margin: '8px 0' }

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', margin: '12px 0' }}>
      <div style={{ flex: '0 0 30px', height: 30, borderRadius: 999, background: RED, color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n}</div>
      <div style={{ paddingTop: 3 }}>{children}</div>
    </div>
  )
}

export default function UtahDealerChallengePage(
  { searchParams }: { searchParams?: { dealer?: string } },
) {
  // Carry dealer-page attribution (e.g. from /for/<slug> CTA) through to the
  // form. Only a clean slug is forwarded; the server action validates it against
  // the live-dealer allowlist before storing (anti-impersonation).
  const rawDealer = searchParams?.dealer
  const dealer =
    typeof rawDealer === 'string' && /^[a-z0-9-]{1,60}$/.test(rawDealer) ? rawDealer : undefined
  return (
    <main style={page}>
      {/* Hero */}
      <section style={{ borderBottom: '1px solid #26262c', padding: '56px 0 44px', textAlign: 'center' }}>
        <div style={wrap}>
          <div style={{ color: RED, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', fontSize: 13 }}>The Utah AI Lead Revival Challenge</div>
          <h1 style={{ fontSize: 36, fontWeight: 900, lineHeight: 1.15, margin: '14px 0 16px' }}>
            Your dealership already paid for the leads.<br />AI can help find the buyers still hiding inside them.
          </h1>
          <p style={{ fontSize: 18, color: '#c9c9d1', maxWidth: 680, margin: '0 auto 28px' }}>
            DLR is selecting <strong>one Utah dealership</strong> for a free, controlled lead-revival pilot.
            Provide 25–50 old, consented leads. Approve the messages. Keep every buyer conversation and every sale.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="#apply" style={cta}>Apply for the Free Pilot</a>
            <a href="#how" style={ctaGhost}>See How the Pilot Works</a>
          </div>
        </div>
      </section>

      <div style={wrap}>
        {/* How it works */}
        <section id="how" style={card}>
          <h2 style={h2}>How the pilot works</h2>
          <Step n={1}>The dealer selects 25–50 old leads that are no longer being actively worked.</Step>
          <Step n={2}>The dealer confirms consent and approves the campaign and every message.</Step>
          <Step n={3}>DLR uses AI-assisted messaging to re-engage those leads by text.</Step>
          <Step n={4}>Interested buyers are returned directly to the dealership.</Step>
          <Step n={5}>The dealer keeps every opportunity.</Step>
        </section>

        {/* Risk reversal */}
        <section style={card}>
          <h2 style={h2}>No risk, no strings</h2>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li style={li}>No setup fee and no long-term contract.</li>
            <li style={li}>No CRM replacement and no new advertising spend required.</li>
            <li style={li}>The dealer approves the lead batch and approves every message.</li>
            <li style={li}>The dealer owns every response.</li>
            <li style={li}>The campaign stops immediately at the dealer’s request.</li>
          </ul>
        </section>

        {/* Qualification */}
        <section style={card}>
          <h2 style={h2}>Who the pilot is for</h2>
          <p style={{ marginTop: 0, color: '#c9c9d1' }}>The pilot is intended for dealers that:</p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li style={li}>Generate internet or CRM leads.</li>
            <li style={li}>Have old, unsold leads sitting in the CRM.</li>
            <li style={li}>Can verify appropriate communication consent.</li>
            <li style={li}>Can assign someone to respond to revived buyers.</li>
            <li style={li}>Will allow DLR to document results — anonymously if preferred.</li>
          </ul>
        </section>

        {/* Application */}
        <section id="apply" style={card}>
          <h2 style={h2}>Apply for the free pilot</h2>
          <p style={{ marginTop: 0, color: '#c9c9d1' }}>
            Tell us about your dealership and we’ll be in touch. In the meantime, it helps to know roughly
            how many old leads you have and which CRM or lead tool you use — mention it when we connect.
          </p>
          <div style={{ background: '#0f0f13', borderRadius: 12, padding: 8 }}>
            <BookDemoForm dealer={dealer} />
          </div>
        </section>

        {/* Credibility */}
        <section style={{ ...card, background: 'transparent', border: 'none', textAlign: 'center' }}>
          <p style={{ color: '#9a9aa4', fontSize: 14, maxWidth: 640, margin: '0 auto' }}>
            This is DLR’s first controlled dealership pilot. We’re selecting one Utah dealer to build a
            real-world case study. We don’t imply results or customers we don’t yet have — the goal is to
            produce one honest, measurable outcome together.
          </p>
        </section>

        <footer style={{ padding: '24px 0 48px', textAlign: 'center', color: '#6c6c76', fontSize: 13 }}>
          Dead Lead Revival · Utah · <a href="mailto:brian@dlr-sms.com" style={{ color: '#9a9aa4' }}>brian@dlr-sms.com</a> · dlr-sms.com
        </footer>
      </div>
    </main>
  )
}
