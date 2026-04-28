export const metadata = {
  title: 'Privacy Policy — DLR by BCHardy LLC',
  description: 'Privacy Policy for DLR SMS service operated by BCHardy LLC',
  robots: 'index, follow',
}

export default function PrivacyPage() {
  const effectiveDate = 'April 28, 2026'

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px', fontFamily: 'system-ui, sans-serif', color: '#111', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Privacy Policy</h1>
      <p style={{ color: '#555', marginTop: 0 }}>Effective date: {effectiveDate}</p>

      <p>
        BCHardy LLC ("we," "us," or "our") operates the DLR Dead Lead Revival SMS platform
        ("Service") on behalf of automotive dealerships. This Privacy Policy explains how we
        collect, use, and protect personal information in connection with the Service.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>1. Information We Collect</h2>
      <p>
        We collect personal information that dealerships provide to us about their leads and
        customers, including: first name, last name, phone number, email address, vehicle of
        interest, lead source, and the date and method by which consent to receive SMS messages
        was obtained.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>2. How We Use Information</h2>
      <p>
        We use personal information solely to deliver the Service — specifically, to send
        automated SMS follow-up messages to leads who have previously inquired about a vehicle
        purchase and provided consent to be contacted. We do not sell, rent, or share personal
        information with third parties for their own marketing purposes.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>3. SMS Messaging</h2>
      <p>
        We send SMS messages only to individuals who have provided explicit or implied consent
        to receive communications from the dealership. Every message includes instructions to
        reply STOP to opt out. Opt-out requests are honored immediately and permanently.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>4. Data Retention</h2>
      <p>
        Personal information is retained for as long as necessary to deliver the Service or as
        required by applicable law. Dealerships may request deletion of their data at any time
        by contacting us at the address below.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>5. Security</h2>
      <p>
        We implement reasonable technical and organizational measures to protect personal
        information against unauthorized access, disclosure, or loss.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>6. Contact</h2>
      <p>
        Questions about this Privacy Policy should be directed to:<br />
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
