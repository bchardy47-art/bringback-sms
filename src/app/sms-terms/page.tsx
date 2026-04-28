export const metadata = {
  title: 'SMS Terms — DLR by BCHardy LLC',
  description: 'SMS messaging terms and consent policy for DLR, operated by BCHardy LLC',
  robots: 'index, follow',
}

export default function SmsTermsPage() {
  const effectiveDate = 'April 28, 2026'

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px', fontFamily: 'system-ui, sans-serif', color: '#111', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>SMS Messaging Terms</h1>
      <p style={{ color: '#555', marginTop: 0 }}>Effective date: {effectiveDate}</p>

      <p>
        BCHardy LLC operates DLR, an SMS follow-up platform for automotive dealerships.
        These SMS Terms describe how text messages are sent through the Service, how consent
        is collected, and how recipients can opt out.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>1. Who Sends These Messages</h2>
      <p>
        SMS messages are sent by BCHardy LLC on behalf of automotive dealership clients through
        the DLR platform. Messages originate from a 10DLC-registered long code number assigned
        to the dealership.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>2. Types of Messages Sent</h2>
      <p>
        The Service sends automated follow-up SMS messages to individuals who have previously
        submitted a vehicle inquiry to a participating dealership and have not yet been contacted
        or responded. Messages may include: a greeting by first name, the dealership's name,
        a reference to the vehicle inquired about, and an invitation to respond or visit.
      </p>
      <p>
        Message frequency varies. Typically no more than 3 messages are sent per lead per
        campaign, spaced several days apart.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>3. Consent</h2>
      <p>
        Messages are sent only to individuals who have provided consent to receive SMS
        communications from the dealership — either by submitting a web inquiry form that
        includes SMS opt-in language, or by calling the dealership and providing their phone
        number for follow-up contact. Consent records, including the source and date/time of
        consent, are retained in the system.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>4. How to Opt Out</h2>
      <p>
        Reply <strong>STOP</strong> to any message to immediately unsubscribe. You will receive
        a one-time confirmation message and no further messages will be sent. You may also reply
        <strong> HELP</strong> for assistance.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>5. Message and Data Rates</h2>
      <p>
        Message and data rates may apply depending on your mobile carrier plan. BCHardy LLC is
        not responsible for charges imposed by your carrier.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>6. Contact</h2>
      <p>
        For questions about SMS messaging or to request removal from all messaging:<br />
        <strong>BCHardy LLC</strong><br />
        1346 West Fort Rock Drive<br />
        Saratoga Springs, UT 84045<br />
        <a href="mailto:bc.hardy47@gmail.com" style={{ color: '#0070f3' }}>bc.hardy47@gmail.com</a>
      </p>

      <p style={{ marginTop: 48, fontSize: 13, color: '#888' }}>
        © {new Date().getFullYear()} BCHardy LLC. All rights reserved.
      </p>
    </main>
  )
}
