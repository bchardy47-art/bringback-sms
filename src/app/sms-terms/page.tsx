export const metadata = {
  title: 'SMS Terms — DLR by BCHardy LLC',
  description: 'SMS messaging terms and consent policy for the DLR platform operated by BCHardy LLC',
  robots: 'index, follow',
}

export default function SmsTermsPage() {
  const effectiveDate = 'May 16, 2026'

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px', fontFamily: 'system-ui, sans-serif', color: '#111', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>SMS Messaging Terms</h1>
      <p style={{ color: '#555', marginTop: 0 }}>Effective date: {effectiveDate}</p>

      <p>
        DLR ("Service") is a software platform operated by BCHardy LLC ("BCHardy") that
        helps automotive dealerships ("dealerships") send SMS messages to their own prior
        leads. These SMS Terms describe how messages are sent through the Service and how
        recipients can opt out.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>1. Who the Sender Is</h2>
      <p>
        <strong>The dealership is the sender of record for messages sent to its leads.</strong>{' '}
        Messages originate from a 10DLC-registered long-code number assigned to the
        dealership's brand. BCHardy provides the underlying platform and messaging
        infrastructure but is not the source of consent and does not author message content
        on behalf of the dealership.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>2. Consent</h2>
      <p>
        <strong>The dealership is solely responsible for ensuring that each recipient has
        provided lawful consent to receive SMS messages.</strong> Consent is typically
        collected when a customer submits a web inquiry form that includes SMS opt-in
        language, calls the dealership and provides a phone number for follow-up, or
        otherwise affirmatively agrees to be contacted. The dealership must retain
        documentation of consent and is responsible for the lawfulness, accuracy, and
        provenance of any contact data uploaded into the Service — regardless of whether
        the data came from a CRM export, a third-party aggregator, a web form, or manual
        entry.
      </p>
      <p>
        DLR is a <strong>tool</strong> the dealership uses to send messages. The Service
        does not certify, audit, or guarantee the consent status of any contact uploaded by
        the dealership.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>3. Types of Messages Sent</h2>
      <p>
        Outbound messages are automated follow-ups to prior leads, typically referencing the
        vehicle the lead inquired about and inviting a response. Message frequency varies by
        campaign; typically no more than three messages per lead per campaign, spaced
        several days apart. Conversations may continue if the recipient replies.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>4. How to Opt Out</h2>
      <p>
        Reply <strong>STOP</strong> to any message to immediately unsubscribe from further
        messages from that dealership. You will receive a one-time confirmation. Reply
        <strong> HELP</strong> for assistance. Opt-out requests are honored automatically
        and recorded.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>5. Message and Data Rates</h2>
      <p>
        Message and data rates may apply depending on your mobile carrier plan. Neither the
        dealership nor BCHardy is responsible for charges imposed by your wireless carrier.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>6. Carrier Filtering and Deliverability</h2>
      <p>
        SMS delivery in the United States depends on third-party wireless carriers,
        intermediary aggregators, and 10DLC registration. <strong>Carrier filtering,
        throughput limits, and delivery outcomes are not within BCHardy's control and are
        not guaranteed.</strong> Messages may be delayed, throttled, blocked, or filtered by
        carriers for reasons including registration status, content patterns, sending
        velocity, and recipient carrier policy. BCHardy is not liable for non-delivery or
        delivery delays caused by carriers or aggregators.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>7. Privacy</h2>
      <p>
        See our <a href="/privacy" style={{ color: '#0070f3' }}>Privacy Policy</a> for how
        personal information is collected and used in connection with the Service.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>8. Contact</h2>
      <p>
        For questions about SMS messaging or to request removal from all messaging by a
        specific dealership:<br />
        <strong>BCHardy LLC</strong><br />
        1346 West Fort Rock Drive<br />
        Saratoga Springs, UT 84045<br />
        <a href="mailto:bc.hardy47@gmail.com" style={{ color: '#0070f3' }}>bc.hardy47@gmail.com</a>
      </p>

      <p style={{ marginTop: 32 }}>
        Related policies:{' '}
        <a href="/terms" style={{ color: '#0070f3' }}>Terms of Service</a> ·{' '}
        <a href="/privacy" style={{ color: '#0070f3' }}>Privacy Policy</a>
      </p>

      <p style={{ marginTop: 48, fontSize: 13, color: '#888' }}>
        © {new Date().getFullYear()} BCHardy LLC. All rights reserved.
      </p>
    </main>
  )
}
