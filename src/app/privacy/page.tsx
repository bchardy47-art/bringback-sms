export const metadata = {
  title: 'Privacy Policy — DLR by BCHardy LLC',
  description: 'Privacy Policy for the DLR platform operated by BCHardy LLC',
  robots: 'index, follow',
}

export default function PrivacyPage() {
  const effectiveDate = 'May 16, 2026'

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px', fontFamily: 'system-ui, sans-serif', color: '#111', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Privacy Policy</h1>
      <p style={{ color: '#555', marginTop: 0 }}>Effective date: {effectiveDate}</p>

      <p>
        BCHardy LLC ("BCHardy", "we", "us", "our") operates the DLR platform ("Service") for
        automotive dealerships. This Privacy Policy explains what personal information we
        collect, how we use it, and the third parties we share it with in order to deliver
        the Service.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>1. Information We Collect</h2>
      <p>
        <strong>From dealerships (our clients):</strong> business identity (legal name, EIN,
        addresses), administrator and staff names, email addresses, mobile numbers, plan
        selection, payment method tokens (handled by Stripe — we do not see or store card
        numbers), and the information necessary to register 10DLC campaigns with wireless
        carriers.
      </p>
      <p>
        <strong>About the dealership's leads and customers (uploaded by the dealership):</strong>{' '}
        names, phone numbers, email addresses, vehicle of interest, lead source, prior
        consent records, and message history.
      </p>
      <p>
        <strong>Automatic:</strong> server logs (IP address, browser, timestamps), usage
        events within the application, and message-delivery metadata from carriers.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>2. How We Use Information</h2>
      <p>
        We use personal information to provide, operate, secure, and improve the Service —
        specifically, to authenticate users, send outbound SMS on behalf of the dealership,
        record opt-outs, generate reports, register and maintain carrier campaigns, bill
        clients, and provide support. We do not sell personal information. We do not use
        lead or customer information for our own marketing.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>3. Service Providers / Sub-processors</h2>
      <p>
        We rely on the following sub-processors to deliver the Service. Each receives only
        what it needs to perform its function:
      </p>
      <ul>
        <li><strong>Stripe, Inc.</strong> — payment processing, subscription billing, payment-method storage.</li>
        <li><strong>Telnyx LLC</strong> — SMS and MMS message delivery, number provisioning, 10DLC campaign registration.</li>
        <li><strong>DigitalOcean LLC</strong> — application and database hosting.</li>
        <li><strong>Email delivery provider</strong> — transactional notifications.</li>
      </ul>
      <p>
        We disclose information to law enforcement or other parties when required by law,
        when necessary to investigate fraud or violations of our Terms, or to protect the
        rights and safety of BCHardy, our clients, or the public.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>4. SMS Messaging</h2>
      <p>
        Outbound SMS messages are sent on behalf of the dealership to leads who have
        consented to receive communications from that dealership. Every message includes
        opt-out language ("Reply STOP to opt out"). Opt-out requests are honored
        automatically and persisted. See our{' '}
        <a href="/sms-terms" style={{ color: '#0070f3' }}>SMS Terms</a> for more detail.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>5. Data Retention</h2>
      <p>
        We retain personal information for as long as needed to provide the Service, comply
        with legal obligations, resolve disputes, and enforce our Terms. Dealerships may
        request deletion of their tenant data by contacting us at the address below; we will
        delete or anonymize records within a reasonable period unless we are required to
        retain them by law (for example, billing records or carrier-mandated opt-out
        evidence).
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>6. Your Choices</h2>
      <p>
        Recipients of SMS can opt out at any time by replying STOP. Dealership clients can
        update or remove account information from within the application or by contacting
        support. Where applicable law gives you additional rights (for example, the right to
        access, correct, or delete personal information), please contact us using the email
        below.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>7. Security</h2>
      <p>
        We use industry-standard technical and organizational safeguards, including
        encryption in transit (TLS), encrypted credential storage (bcrypt), least-privilege
        access controls, and audit logs. No system is perfectly secure; we cannot guarantee
        absolute security.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>8. Children</h2>
      <p>
        The Service is intended for business use by dealership personnel and is not directed
        to children under 13. We do not knowingly collect personal information from children.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>9. Changes</h2>
      <p>
        We may update this Privacy Policy from time to time. The current version always
        appears at this URL with an updated effective date.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>10. Contact</h2>
      <p>
        <strong>BCHardy LLC</strong><br />
        1346 West Fort Rock Drive<br />
        Saratoga Springs, UT 84045<br />
        <a href="mailto:bc.hardy47@gmail.com" style={{ color: '#0070f3' }}>bc.hardy47@gmail.com</a>
      </p>

      <p style={{ marginTop: 32 }}>
        Related policies:{' '}
        <a href="/terms" style={{ color: '#0070f3' }}>Terms of Service</a> ·{' '}
        <a href="/sms-terms" style={{ color: '#0070f3' }}>SMS Terms</a>
      </p>

      <p style={{ marginTop: 48, fontSize: 13, color: '#888' }}>
        © {new Date().getFullYear()} BCHardy LLC. All rights reserved.
      </p>
    </main>
  )
}
