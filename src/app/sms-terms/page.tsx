export const metadata = {
  title: 'SMS Terms — DLR by BCHardy LLC',
  description: 'SMS messaging terms and consent policy for the DLR platform operated by BCHardy LLC',
  robots: 'index, follow',
}

export default function SmsTermsPage() {
  const effectiveDate = 'May 17, 2026'

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
        <strong>The dealership is the sender of record for every message sent to its
        leads through the Service.</strong> Messages originate from a 10DLC-registered
        long-code number assigned to the dealership's brand. The dealership owns its
        leads, its customer relationships, its message content, and its consent records.
        BCHardy provides the underlying platform and messaging infrastructure; BCHardy is
        not the source of consent, does not author message content, and does not select
        which individuals are contacted.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>2. Consent — the Dealership&apos;s Responsibility</h2>
      <p>
        <strong>The dealership is solely responsible for ensuring that each recipient has
        provided the consent required by law and carrier policy to receive SMS messages
        from the dealership about the vehicle or topic in question.</strong> This applies
        regardless of how the contact data reached the Service: CRM export, web inquiry
        form, phone-room intake, third-party lead aggregator, manual entry, or any other
        source. Common consent capture moments include a customer submitting a web inquiry
        form with SMS opt-in language, calling the dealership and providing a number for
        follow-up, or otherwise affirmatively agreeing to be contacted.
      </p>
      <p>
        <strong>The dealership — not BCHardy — is responsible for retaining, producing,
        and defending evidence of consent</strong> if any individual contacted through the
        Service challenges the outreach (including by complaint, opt-out, suit, regulatory
        inquiry, carrier dispute, or otherwise). DLR is software the dealership uses to
        send messages; the Service does not certify, audit, or guarantee the consent
        status of any contact uploaded by the dealership.
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
        <strong> HELP</strong> for assistance. STOP-style opt-out requests sent through
        the Service are honored automatically and recorded.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>4a. Dealership Opt-Out and Suppression Obligations</h2>
      <p>
        The dealership must honor every opt-out, revocation of consent, or do-not-contact
        request that applies to its outreach, whether or not that request was made through
        the Service. This includes:
      </p>
      <ul>
        <li>STOP / opt-out replies captured by the Service automatically.</li>
        <li>
          Opt-outs and do-not-contact requests received outside the Service — by phone,
          email, in person, web form, voicemail, social channel, or any other channel.
        </li>
        <li>
          Entries on the dealership's internal suppression / do-not-call list, on any
          third-party suppression list the dealership is obligated to honor, and on
          federal or state do-not-call registries to the extent applicable.
        </li>
      </ul>
      <p>
        The dealership will not re-contact an opted-out individual through the Service,
        through another platform, or through a different number. Opt-outs are permanent
        unless and until the individual affirmatively re-opts-in through a documented
        consent event.
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

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>7. Dealership Warranties and Indemnification</h2>
      <p>
        These SMS Terms are part of, and incorporated into, the{' '}
        <a href="/terms" style={{ color: '#0070f3' }}>Terms of Service</a>. The dealership
        makes the representations and warranties set forth in Section 5 of the Terms of
        Service — including warranties about lawful source of data, recipient consent,
        sender-of-record status, and opt-out / suppression obligations — and indemnifies
        BCHardy under Section 11 of the Terms of Service for any claim arising from the
        dealership's contact data, consent failures, message content, or unlawful use of
        the Service.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>8. Privacy</h2>
      <p>
        See our <a href="/privacy" style={{ color: '#0070f3' }}>Privacy Policy</a> for how
        personal information is collected and used in connection with the Service.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>9. Contact</h2>
      <p>
        For questions about SMS messaging or to request removal from all messaging by a
        specific dealership:<br />
        <strong>BCHardy LLC</strong><br />
        1346 West Fort Rock Drive<br />
        Saratoga Springs, UT 84045<br />
        <a href="mailto:support@dlr-sms.com" style={{ color: '#0070f3' }}>support@dlr-sms.com</a>
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
