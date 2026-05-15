import { SmsConsentForm } from './SmsConsentForm'

export const metadata = {
  title: 'SMS Opt-In | Dead Lead Revival (DLR) — BCHardy LLC',
  description: 'Opt in to receive SMS follow-up messages from BCHardy LLC regarding your vehicle purchase inquiry.',
  robots: 'index, follow',
}

export default function SmsConsentPage() {
  return (
    <main style={{ maxWidth: 600, margin: '0 auto', padding: '48px 24px', fontFamily: 'system-ui, sans-serif', color: '#111', lineHeight: 1.7 }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <p style={{ fontSize: 13, color: '#888', margin: '0 0 6px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>BCHardy LLC · Dead Lead Revival (DLR)</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 10px 0' }}>Vehicle Inquiry SMS Follow-Up</h1>
        <p style={{ fontSize: 16, color: '#444', margin: 0 }}>
          If you submitted a vehicle purchase inquiry and would like to receive SMS follow-up
          messages from our team, enter your information below to opt in.
        </p>
      </div>

      <SmsConsentForm />

      {/* What to expect */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>What to Expect</h2>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 15, color: '#444' }}>
          <li>A confirmation SMS will be sent to your number after you submit.</li>
          <li>Our team will follow up regarding your vehicle inquiry via text message.</li>
          <li>You can reply <strong>STOP</strong> at any time to stop receiving messages.</li>
          <li>Reply <strong>HELP</strong> to receive contact information for support.</li>
          <li>Message frequency varies based on your inquiry and responses.</li>
          <li>Message and data rates may apply depending on your carrier plan.</li>
        </ul>
      </section>

      {/* Business Info */}
      <section style={{ marginBottom: 32, fontSize: 14, color: '#555' }}>
        <p style={{ margin: '0 0 4px 0' }}><strong>Sender:</strong> BCHardy LLC (Dead Lead Revival / DLR)</p>
        <p style={{ margin: '0 0 4px 0' }}><strong>Address:</strong> 1346 W Fort Rock Dr, Saratoga Springs, UT 84045</p>
        <p style={{ margin: '0 0 4px 0' }}><strong>Phone:</strong> <a href="tel:+18013800445" style={{ color: '#0070f3' }}>+1 (801) 380-0445</a></p>
        <p style={{ margin: 0 }}><strong>Email:</strong> <a href="mailto:bc.hardy47@gmail.com" style={{ color: '#0070f3' }}>bc.hardy47@gmail.com</a></p>
      </section>

      {/* Legal links */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 14, marginBottom: 32 }}>
        <a href="/privacy" style={{ color: '#0070f3' }}>Privacy Policy</a>
        <a href="/terms" style={{ color: '#0070f3' }}>Terms of Service</a>
        <a href="/sms-terms" style={{ color: '#0070f3' }}>SMS Terms</a>
      </div>

      <p style={{ fontSize: 13, color: '#aaa', margin: 0 }}>
        © {new Date().getFullYear()} BCHardy LLC. All rights reserved.
      </p>
    </main>
  )
}
