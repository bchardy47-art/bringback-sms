import Link from 'next/link'
import { trackEvent } from '@/lib/activity/track'

// Personalized, dealer-specific page for Mountainland Auto Sales.
// APPROVED for deployment (Brian, review package). NOINDEX + unlinked from nav.
// A page view records an internal CRM engagement signal only — it never
// triggers any outreach to the dealership.
export const dynamic = 'force-dynamic'

const DEALER_SLUG = 'mountainland-auto-sales'
const DEALER_NAME = 'Mountainland Auto Sales'

export const metadata = {
  title: `Prepared for ${DEALER_NAME} — DLR`,
  description: `A sample lead-revival proposal prepared for ${DEALER_NAME} using publicly available information.`,
  robots: 'noindex, nofollow',
}

const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const RED = '#e23b3b'
const INK = '#0b0b0d'
const page: React.CSSProperties = { minHeight: '100vh', margin: 0, background: INK, color: '#f5f5f7', fontFamily: FONT, lineHeight: 1.55 }
const wrap: React.CSSProperties = { maxWidth: 820, margin: '0 auto', padding: '0 22px' }
const card: React.CSSProperties = { background: '#141418', border: '1px solid #26262c', borderRadius: 14, padding: 22, margin: '16px 0' }
const tag: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#9a9aa4' }
const msg: React.CSSProperties = { background: '#0f0f13', border: '1px solid #26262c', borderRadius: 10, padding: 12, margin: '8px 0', color: '#d7d7de', fontSize: 14 }
const cta: React.CSSProperties = { display: 'inline-block', background: RED, color: '#fff', fontWeight: 700, padding: '14px 26px', borderRadius: 10, textDecoration: 'none' }

export default async function MountainlandForPage() {
  // Internal CRM engagement signal only. Best-effort; never triggers outreach.
  await trackEvent('dealer_page_viewed', {
    path: `/for/${DEALER_SLUG}`,
    metadata: { dealer: DEALER_SLUG, channel: 'personalized_page' },
  })

  return (
    <main style={page}>
      <section style={{ padding: '48px 0 32px', borderBottom: '1px solid #26262c', textAlign: 'center' }}>
        <div style={wrap}>
          <div style={{ color: RED, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, fontSize: 12 }}>
            Prepared specifically for {DEALER_NAME} · Heber City, UT
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 900, lineHeight: 1.18, margin: '12px 0' }}>
            {DEALER_NAME} — some buyers you already paid to reach may still be in the market.
          </h1>
          <p style={{ color: '#c9c9d1', maxWidth: 660, margin: '10px auto 0' }}>
            This page was prepared specifically for {DEALER_NAME} using publicly available dealership information.
            It was created by the same AI-assisted workflow DLR uses to identify dormant buyer opportunities.
          </p>
        </div>
      </section>

      <div style={wrap}>
        <section style={card}>
          <span style={tag}>Verified public information</span>
          <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
            <li>Website: <a href="https://www.mountainlandautosales.com/" style={{ color: '#e2a3a3' }}>mountainlandautosales.com</a></li>
            <li>Public phone: 435-657-1111</li>
            <li>Family-run dealership, roughly 15 years in business (per public listings)</li>
            <li>Large used car & truck inventory (per public listings)</li>
            <li>Publicly listed owner: Shane Clegg</li>
          </ul>
          <p style={{ ...tag, marginTop: 10 }}>Estimate</p>
          <p style={{ margin: '2px 0 0', color: '#c9c9d1', fontSize: 14 }}>Approx. inventory on hand: ~140–150 vehicles (estimated from public inventory listings).</p>
        </section>

        <section style={card}>
          <span style={tag}>Industry framing — general, not a claim about this dealership</span>
          <p style={{ marginBottom: 0 }}>
            A dealership with active online inventory and ongoing lead generation commonly accumulates unsold
            inquiries over time. Those inquiries represent buyers a dealership already paid to acquire — and some
            may still be in the market. A small, controlled re-engagement test is a low-risk way to find out.
          </p>
        </section>

        <section style={card}>
          <span style={tag}>Sample messaging — examples only, requires your approval</span>
          <div style={msg}>1. “Hi [First Name], this is [Name] at {DEALER_NAME}. You reached out to us a while back about a vehicle — are you still looking, or did you already find something? Reply STOP to opt out.”</div>
          <div style={msg}>2. “[First Name], we just took in some trades that match what you wanted. Want me to send a couple options? No pressure. Reply STOP to opt out.”</div>
          <div style={msg}>3. “Hi [First Name] — checking in one last time. If the timing’s better now, I’m happy to help. Reply STOP to opt out.”</div>
        </section>

        <section style={{ ...card, textAlign: 'center' }}>
          <span style={tag}>The offer</span>
          <h2 style={{ fontSize: 20, margin: '6px 0 10px' }}>Free controlled pilot for {DEALER_NAME}</h2>
          <ul style={{ display: 'inline-block', textAlign: 'left', margin: '0 0 16px', paddingLeft: 20, color: '#c9c9d1' }}>
            <li>You select 25–50 older leads that are appropriate for a controlled re-engagement campaign</li>
            <li>7-day test — you approve every message</li>
            <li>No fee, no contract, no CRM change</li>
            <li>Every warm response returned directly to you</li>
          </ul>
          <div>
            <Link href={`/utah-dealer-challenge?dealer=${DEALER_SLUG}`} style={cta}>Claim the Free Pilot for {DEALER_NAME}</Link>
          </div>
        </section>

        <p style={{ color: '#7c7c86', fontSize: 12, margin: '18px 0 40px' }}>
          {DEALER_NAME} has not participated in, agreed to, or endorsed DLR. This proposal does not make any claim
          about {DEALER_NAME}’s current lead-management practices. Sample messages are illustrative and require
          dealership approval. Only leads with an appropriate lawful basis for SMS contact may be included.
          Brian Hardy · Dead Lead Revival · brian@dlr-sms.com · dlr-sms.com
        </p>
      </div>
    </main>
  )
}
