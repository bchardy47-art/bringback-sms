export const metadata = {
  title: 'DLR — Dead Lead Revival | BCHardy LLC',
  description: 'Dead Lead Revival (DLR) is an SMS re-engagement platform for automotive dealerships, operated by BCHardy LLC.',
  robots: 'index, follow',
}

export default function RootPage() {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px', fontFamily: 'system-ui, sans-serif', color: '#111', lineHeight: 1.7 }}>

      {/* Header */}
      <div style={{ marginBottom: 40 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, margin: '0 0 8px 0' }}>DLR — Dead Lead Revival</h1>
        <p style={{ fontSize: 18, color: '#555', margin: 0 }}>SMS re-engagement platform for automotive dealerships</p>
      </div>

      {/* About */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>About</h2>
        <p style={{ margin: 0 }}>
          Dead Lead Revival (DLR) is a SaaS platform operated by BCHardy LLC that enables licensed
          automotive dealership clients to send automated SMS follow-up messages to customers who
          previously submitted a vehicle purchase inquiry. Messages are sent on behalf of each
          dealership client and identify the dealership by name. The platform helps dealerships
          re-engage old leads and recover lost revenue through compliant, opt-out-ready SMS outreach.
        </p>
      </section>

      {/* Services */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Core Services</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>Automated SMS lead re-engagement for automotive dealerships</li>
          <li>Multi-dealership SaaS platform with per-dealer tenant isolation</li>
          <li>10DLC-compliant messaging with opt-in/opt-out management</li>
          <li>Lead import, workflow automation, and conversation inbox</li>
        </ul>
      </section>

      {/* Business Info */}
      <section style={{ marginBottom: 40, background: '#f9f9f9', borderRadius: 8, padding: '24px 28px' }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16, marginTop: 0 }}>Business Information</h2>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            <tr>
              <td style={{ fontWeight: 600, paddingRight: 24, paddingBottom: 10, verticalAlign: 'top', whiteSpace: 'nowrap' }}>Legal Name</td>
              <td style={{ paddingBottom: 10 }}>BCHardy LLC</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600, paddingRight: 24, paddingBottom: 10, verticalAlign: 'top', whiteSpace: 'nowrap' }}>Address</td>
              <td style={{ paddingBottom: 10 }}>1346 W Fort Rock Dr<br />Saratoga Springs, UT 84045</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600, paddingRight: 24, paddingBottom: 10, verticalAlign: 'top', whiteSpace: 'nowrap' }}>Phone</td>
              <td style={{ paddingBottom: 10 }}>
                <a href="tel:+18013800445" style={{ color: '#0070f3', textDecoration: 'none' }}>+1 (801) 380-0445</a>
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600, paddingRight: 24, paddingBottom: 10, verticalAlign: 'top', whiteSpace: 'nowrap' }}>Email</td>
              <td style={{ paddingBottom: 10 }}>
                <a href="mailto:bc.hardy47@gmail.com" style={{ color: '#0070f3', textDecoration: 'none' }}>bc.hardy47@gmail.com</a>
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600, paddingRight: 24, verticalAlign: 'top', whiteSpace: 'nowrap' }}>Website</td>
              <td>https://dlr-sms.com</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Links */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Legal</h2>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <a href="/privacy" style={{ color: '#0070f3' }}>Privacy Policy</a>
          <a href="/terms" style={{ color: '#0070f3' }}>Terms of Service</a>
          <a href="/sms-terms" style={{ color: '#0070f3' }}>SMS Terms</a>
        </div>
      </section>

      {/* Login */}
      <section style={{ marginBottom: 40 }}>
        <a href="/login" style={{
          display: 'inline-block',
          background: '#0070f3',
          color: '#fff',
          padding: '10px 24px',
          borderRadius: 6,
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: 15,
        }}>Dealer Login →</a>
      </section>

      <p style={{ marginTop: 48, fontSize: 13, color: '#888' }}>
        © {new Date().getFullYear()} BCHardy LLC. All rights reserved.
      </p>
    </main>
  )
}
