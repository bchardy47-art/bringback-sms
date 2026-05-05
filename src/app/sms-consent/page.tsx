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

      {/* Form */}
      <form
        action="#"
        method="post"
        style={{
          background: '#f9f9f9',
          borderRadius: 10,
          padding: '28px 32px',
          marginBottom: 32,
          border: '1px solid #e5e5e5',
        }}
      >
        {/* First Name */}
        <div style={{ marginBottom: 18 }}>
          <label htmlFor="first_name" style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>
            First Name <span style={{ color: '#c00' }}>*</span>
          </label>
          <input
            type="text"
            id="first_name"
            name="first_name"
            placeholder="Jane"
            required
            style={inputStyle}
          />
        </div>

        {/* Last Name */}
        <div style={{ marginBottom: 18 }}>
          <label htmlFor="last_name" style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>
            Last Name <span style={{ color: '#c00' }}>*</span>
          </label>
          <input
            type="text"
            id="last_name"
            name="last_name"
            placeholder="Smith"
            required
            style={inputStyle}
          />
        </div>

        {/* Phone Number */}
        <div style={{ marginBottom: 18 }}>
          <label htmlFor="phone" style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>
            Mobile Phone Number <span style={{ color: '#c00' }}>*</span>
          </label>
          <input
            type="tel"
            id="phone"
            name="phone"
            placeholder="(801) 555-0100"
            required
            style={inputStyle}
          />
        </div>

        {/* Vehicle Interest */}
        <div style={{ marginBottom: 24 }}>
          <label htmlFor="vehicle_interest" style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>
            Vehicle of Interest
          </label>
          <input
            type="text"
            id="vehicle_interest"
            name="vehicle_interest"
            placeholder="e.g. 2024 Toyota Camry"
            style={inputStyle}
          />
        </div>

        {/* Consent Checkbox */}
        <div style={{
          background: '#fff',
          border: '1px solid #d0d0d0',
          borderRadius: 8,
          padding: '16px 18px',
          marginBottom: 20,
        }}>
          <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="checkbox"
              name="sms_consent"
              style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 13, color: '#333', lineHeight: 1.6 }}>
              By checking this box and submitting this form, I expressly consent to receive
              recurring automated SMS text messages from <strong>BCHardy LLC</strong> (operating
              as <strong>Dead Lead Revival / DLR</strong>) at the mobile phone number provided
              above. Messages may include follow-up communications regarding my vehicle purchase
              inquiry. <strong>Message frequency varies.</strong> Message and data rates may
              apply. Consent is not a condition of any purchase or service. Reply{' '}
              <strong>STOP</strong> at any time to unsubscribe. Reply <strong>HELP</strong> for
              assistance. View our{' '}
              <a href="/privacy" style={{ color: '#0070f3' }}>Privacy Policy</a> and{' '}
              <a href="/sms-terms" style={{ color: '#0070f3' }}>SMS Terms</a>.
            </span>
          </label>
        </div>

        {/* Submit */}
        <button
          type="submit"
          style={{
            display: 'block',
            width: '100%',
            background: '#0070f3',
            color: '#fff',
            border: 'none',
            borderRadius: 7,
            padding: '13px 0',
            fontSize: 16,
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '0.01em',
          }}
        >
          Opt In to SMS Updates
        </button>

        {/* Below-button disclosure */}
        <p style={{ fontSize: 12, color: '#888', marginTop: 14, marginBottom: 0, textAlign: 'center' }}>
          Check the box above to consent to SMS messages from BCHardy LLC. Msg &amp; data
          rates may apply. Reply STOP to unsubscribe at any time.
        </p>
      </form>

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

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '10px 12px',
  fontSize: 15,
  border: '1px solid #ccc',
  borderRadius: 6,
  boxSizing: 'border-box',
  background: '#fff',
  outline: 'none',
}
