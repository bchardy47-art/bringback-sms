import { TERMS_VERSION } from '@/lib/legal'

export const metadata = {
  title: 'Terms of Service — DLR by BCHardy LLC',
  description: 'Terms of Service for the DLR platform operated by BCHardy LLC',
  robots: 'index, follow',
}

export default function TermsPage() {
  const effectiveDate = 'May 16, 2026'

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px', fontFamily: 'system-ui, sans-serif', color: '#111', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Terms of Service</h1>
      <p style={{ color: '#555', marginTop: 0 }}>Effective date: {effectiveDate} · Version {TERMS_VERSION}</p>

      <p>
        These Terms of Service ("Terms") are a binding agreement between you and your
        dealership ("Client", "you", "your") and BCHardy LLC, a Utah limited liability
        company ("BCHardy", "we", "us", "our"), operator of the DLR platform ("DLR" or the
        "Service"). By clicking "Activate account", signing up, or otherwise using the
        Service, you agree to these Terms.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>1. The Service</h2>
      <p>
        DLR is a software platform that helps automotive dealerships re-engage prior sales
        leads via SMS. The Service includes hosted application access, message delivery
        through third-party telecommunications providers (currently Telnyx), automated
        workflows, dealer-side inbox tooling, and reporting.
      </p>
      <p>
        DLR is a <strong>tool used by the dealership</strong>. Each dealership is the
        sender of record for its own outreach. BCHardy provides the platform and the
        carrier-registered messaging infrastructure but does not originate consent or
        author message content on behalf of the dealership.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>2. Billing and Subscription</h2>
      <p>
        Access to the Service is provided on a recurring subscription basis. You select a
        plan at activation. <strong>BCHardy LLC is the merchant of record for all fees.</strong>{' '}
        Payments are processed by our payment processor (currently Stripe). By providing
        payment information you authorize BCHardy to charge the applicable subscription fees
        and any usage-based charges to your payment method on each renewal date until you
        cancel.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>3. Renewals, Cancellation, and Refunds</h2>
      <p>
        Subscriptions automatically renew at the end of each billing period at the
        then-current rate unless you cancel before the renewal date. You may cancel at any
        time from the Settings area of the application or by emailing us. Cancellation takes
        effect at the end of the current billing period; you will continue to have access
        until then.
      </p>
      <p>
        <strong>Fees are non-refundable</strong> except where required by applicable law or
        expressly stated in writing by BCHardy. We do not pro-rate mid-cycle cancellations.
        If we materially reduce or discontinue the Service during a paid period, we will
        offer a pro-rated refund of the unused portion.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>4. No Guarantee of Results</h2>
      <p>
        DLR is a tool that helps dealerships reach prior leads. It does not guarantee any
        particular outcome. <strong>We make no representation or warranty that the Service
        will produce any specific number of revived leads, appointments, conversations,
        sales, or revenue.</strong> Outreach effectiveness depends on factors outside our
        control, including the quality and freshness of the lead data you provide, the
        consent status of those leads, your dealership's responsiveness, carrier message
        filtering, and market conditions.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>5. Your Responsibilities</h2>
      <p>
        You are solely responsible for:
      </p>
      <ul>
        <li>
          The lawfulness, accuracy, and provenance of all contact data you upload to or
          generate within the Service, including names, phone numbers, email addresses, and
          consent records, regardless of source (CRM export, web form, third-party
          aggregator, manual entry).
        </li>
        <li>
          Obtaining and documenting valid consent from each individual you contact through
          the Service, in compliance with the Telephone Consumer Protection Act (TCPA),
          state law equivalents, the CAN-SPAM Act where applicable, and carrier and CTIA
          messaging guidelines.
        </li>
        <li>
          Honoring opt-outs and "do-not-contact" requests, including those collected outside
          the Service.
        </li>
        <li>
          The content and accuracy of message templates and workflows you approve.
        </li>
        <li>
          Designating an authorized administrator on your account, securing account
          credentials, and the actions taken by anyone using your account.
        </li>
        <li>
          Providing accurate business information (legal entity name, EIN, brand name,
          opt-in language, etc.) for 10DLC and carrier registration.
        </li>
      </ul>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>6. Acceptable Use</h2>
      <p>
        You may not use the Service to send unsolicited messages, harass recipients, contact
        anyone who has opted out or who has not provided lawful consent, send unlawful
        content, evade carrier filtering, or violate any law or carrier policy. We may
        refuse, throttle, or filter outbound messages and may suspend or terminate accounts
        engaged in or reasonably suspected of any of the foregoing.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>7. Carriers, 10DLC, and Deliverability</h2>
      <p>
        SMS messaging in the United States depends on third-party wireless carriers and
        registration processes (including The Campaign Registry / 10DLC). Approval timelines,
        throughput limits, message filtering, and deliverability are determined by carriers
        and are not within BCHardy's control. <strong>BCHardy is not liable for delays,
        suspensions, blocks, throttling, or non-delivery of messages caused by carriers,
        registrars, or telecommunications providers.</strong>
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>8. Suspension and Termination</h2>
      <p>
        We may suspend or terminate your access immediately, with or without notice, for
        nonpayment, suspected fraud, violation of these Terms or our Acceptable Use rules,
        or for risk to the integrity of the platform or to other clients. You may terminate
        your subscription at any time as described in Section 3. On termination, your right
        to access the Service ends, but Sections 3 (Fees), 5 (Your Responsibilities), 9
        (Disclaimers), 10 (Limitation of Liability), and 12 (Governing Law) survive.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>9. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT WARRANTY OF ANY KIND,
        EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION IMPLIED WARRANTIES OF
        MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT
        WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR THAT ANY DATA WILL
        BE DELIVERED OR PRESERVED.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>10. Limitation of Liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, BCHARDY, ITS AFFILIATES, AND ITS LICENSORS
        WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY,
        OR PUNITIVE DAMAGES, OR FOR ANY LOST PROFITS, REVENUE, OR DATA, ARISING OUT OF OR
        RELATING TO THESE TERMS OR THE SERVICE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH
        DAMAGES. BCHARDY'S TOTAL AGGREGATE LIABILITY UNDER OR RELATING TO THESE TERMS WILL
        NOT EXCEED THE AMOUNTS PAID BY YOU TO BCHARDY FOR THE SERVICE IN THE TWELVE (12)
        MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>11. Indemnification</h2>
      <p>
        You will defend, indemnify, and hold harmless BCHardy from and against any claims,
        damages, liabilities, and costs (including reasonable attorneys' fees) arising out
        of or relating to (a) your use of the Service, (b) the data you upload or transmit
        through the Service, (c) your alleged or actual violation of any law (including the
        TCPA and consumer-protection statutes), or (d) your breach of these Terms.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>12. Governing Law</h2>
      <p>
        These Terms are governed by the laws of the State of Utah, without regard to its
        conflict of laws principles. Exclusive jurisdiction and venue for any dispute will
        lie in the state or federal courts located in Utah County, Utah, and the parties
        consent to that jurisdiction.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>13. Changes</h2>
      <p>
        We may update these Terms from time to time. Material changes will be posted at this
        URL with an updated version number and effective date. Continued use of the Service
        after the new effective date constitutes acceptance of the revised Terms.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>14. Contact</h2>
      <p>
        <strong>BCHardy LLC</strong><br />
        1346 West Fort Rock Drive<br />
        Saratoga Springs, UT 84045<br />
        <a href="mailto:bc.hardy47@gmail.com" style={{ color: '#0070f3' }}>bc.hardy47@gmail.com</a>
      </p>

      <p style={{ marginTop: 32 }}>
        Related policies:{' '}
        <a href="/privacy" style={{ color: '#0070f3' }}>Privacy Policy</a> ·{' '}
        <a href="/sms-terms" style={{ color: '#0070f3' }}>SMS Terms</a>
      </p>

      <p style={{ marginTop: 48, fontSize: 13, color: '#888' }}>
        © {new Date().getFullYear()} BCHardy LLC. All rights reserved.
      </p>
    </main>
  )
}
