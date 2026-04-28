export const metadata = {
  title: 'Terms of Service — DLR by BCHardy LLC',
  description: 'Terms of Service for DLR SMS service operated by BCHardy LLC',
  robots: 'index, follow',
}

export default function TermsPage() {
  const effectiveDate = 'April 28, 2026'

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px', fontFamily: 'system-ui, sans-serif', color: '#111', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Terms of Service</h1>
      <p style={{ color: '#555', marginTop: 0 }}>Effective date: {effectiveDate}</p>

      <p>
        These Terms of Service ("Terms") govern the use of the DLR Dead Lead Revival SMS platform
        ("Service") operated by BCHardy LLC ("we," "us," or "our"). By using the Service, dealership
        clients ("Client") agree to these Terms.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>1. Description of Service</h2>
      <p>
        DLR is a software platform that enables automotive dealerships to send automated SMS
        follow-up messages to leads who have previously inquired about vehicle purchases.
        The Service is operated by BCHardy LLC on behalf of its dealership clients.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>2. Client Responsibilities</h2>
      <p>
        Clients are responsible for ensuring that all leads imported into the Service have provided
        valid consent to receive SMS communications. Clients must comply with all applicable federal
        and state laws governing SMS marketing, including the Telephone Consumer Protection Act (TCPA)
        and the CAN-SPAM Act.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>3. SMS Messaging and Opt-Out</h2>
      <p>
        The Service sends SMS messages only to leads with recorded consent. Every message sent
        through the Service includes opt-out instructions ("Reply STOP to opt out"). Opt-out
        requests are processed immediately. Clients may not use the Service to contact individuals
        who have previously opted out.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>4. Acceptable Use</h2>
      <p>
        Clients may not use the Service to send spam, harass recipients, violate any applicable law,
        or contact individuals without proper consent. BCHardy LLC reserves the right to suspend or
        terminate access for any Client that violates these Terms.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>5. Limitation of Liability</h2>
      <p>
        The Service is provided "as is." BCHardy LLC is not liable for any indirect, incidental,
        or consequential damages arising from use of the Service. BCHardy LLC's total liability
        to any Client shall not exceed the fees paid by that Client in the prior 30 days.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>6. Changes to Terms</h2>
      <p>
        We may update these Terms from time to time. Continued use of the Service after changes
        are posted constitutes acceptance of the revised Terms.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>7. Contact</h2>
      <p>
        Questions about these Terms should be directed to:<br />
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
