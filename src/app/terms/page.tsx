import { TERMS_VERSION } from '@/lib/legal'

export const metadata = {
  title: 'Terms of Service — DLR by BCHardy LLC',
  description: 'Terms of Service for the DLR platform operated by BCHardy LLC',
  robots: 'index, follow',
}

export default function TermsPage() {
  const effectiveDate = 'May 17, 2026'

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

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>1. The Service and Sender of Record</h2>
      <p>
        DLR is a software platform that helps automotive dealerships re-engage prior sales
        leads via SMS. The Service includes hosted application access, message delivery
        through third-party telecommunications providers (currently Telnyx), automated
        workflows, dealer-side inbox tooling, and reporting.
      </p>
      <p>
        DLR is <strong>software and infrastructure used by the dealership</strong>. It is
        not a messaging service of BCHardy and is not the originator of consent for any
        message. <strong>The dealership is the sender of record</strong> for every message
        transmitted on its behalf through the Service. The dealership owns its leads, its
        customer relationships, its message content, and its consent records. BCHardy
        provides the platform and the carrier-registered messaging infrastructure; BCHardy
        does not author message content, does not select recipients, and does not represent
        that any recipient has consented to be contacted.
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

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>4. No Guarantee of Results or Delivery</h2>
      <p>
        DLR is a tool. It does not guarantee any particular outcome.{' '}
        <strong>We make no representation or warranty that the Service will produce any
        specific number of message deliveries, replies, revived leads, appointments,
        showroom visits, sales, or revenue, or that any individual message will be
        delivered at all.</strong> Outreach effectiveness depends on factors outside our
        control, including the quality and freshness of the lead data you upload, the
        consent status of those leads, your dealership's responsiveness, carrier message
        filtering and throttling, 10DLC registration status, recipient handset state, and
        market conditions.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>5. Your Representations, Warranties, and Responsibilities</h2>

      <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 24 }}>5.1 Representations and warranties</h3>
      <p>
        By using the Service, and on each occasion that you upload contact data, configure a
        campaign, or send messages, you represent and warrant to BCHardy that:
      </p>
      <ul>
        <li>
          <strong>Authority.</strong> You are authorized to bind the dealership for which
          the account is opened and to enter into these Terms on its behalf.
        </li>
        <li>
          <strong>Lawful source of data.</strong> All names, phone numbers, email addresses,
          consent records, and other contact information you upload to, import into, or
          otherwise process through the Service were obtained lawfully by your dealership in
          the ordinary course of business, regardless of the source (your CRM, your web
          forms, your phone-room intake, third-party lead aggregators, or otherwise).
        </li>
        <li>
          <strong>Consent for outreach.</strong> Each individual you contact through the
          Service has provided the consent required by applicable law and carrier policy to
          receive SMS communications from your dealership about the vehicle or topic
          referenced — including, where applicable, prior express written consent under the
          Telephone Consumer Protection Act (TCPA), and consent meeting state-law equivalents
          (e.g., Florida Mini-TCPA, Washington's CEMA, Oklahoma's TCPA) where the recipient
          is located.
        </li>
        <li>
          <strong>Proof of consent.</strong> Your dealership — not BCHardy — is solely
          responsible for retaining and producing evidence of consent for any contacted
          individual if challenged by a recipient, a regulator, a carrier, a court, or any
          other party. BCHardy does not warrant, certify, or audit the consent status of any
          contact you upload.
        </li>
        <li>
          <strong>Sender of record.</strong> Your dealership is the sender of record for all
          messages your account transmits through the Service. You acknowledge that BCHardy
          is a software platform and message conduit, not the originator of consent and not
          a co-sender or co-author of your dealership's outreach.
        </li>
        <li>
          <strong>Opt-out and suppression.</strong> You will immediately and permanently
          honor every opt-out, "STOP", revocation, or do-not-contact request — whether
          captured by the Service automatically, communicated to your dealership outside the
          Service (by phone, email, in person, web form, or otherwise), or maintained on any
          internal or third-party suppression / do-not-call list applicable to your
          dealership. You will not attempt to re-contact opted-out individuals through the
          Service, through another platform, or through a different number.
        </li>
        <li>
          <strong>Content.</strong> The content and accuracy of every message template,
          workflow, and reply your account approves or sends through the Service is your
          responsibility.
        </li>
        <li>
          <strong>10DLC and carrier registration.</strong> All business information you
          submit for 10DLC / carrier campaign registration (legal entity name, EIN, brand
          name, opt-in language, sample messages, expected volume, etc.) is accurate,
          current, and lawfully attributable to your dealership.
        </li>
        <li>
          <strong>No prohibited content or recipients.</strong> You will not use the
          Service to message individuals who have not consented, to send unlawful or
          carrier-prohibited content (including SHAFT — sex, hate, alcohol, firearms,
          tobacco, controlled substances, or any other category restricted by carriers or
          CTIA guidelines), or to evade carrier filtering.
        </li>
      </ul>
      <p>
        Each of the above is a continuing representation — you make it again every time you
        upload data, configure a campaign, or send a message through the Service.
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 24 }}>5.2 Account responsibilities</h3>
      <p>
        You are also solely responsible for designating an authorized administrator on the
        account, securing account credentials, and for the actions taken by anyone using
        your account, whether authorized by you or not. You will notify us promptly of any
        compromise of your account.
      </p>

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
        to access the Service ends, but Sections 3 (Fees), 5 (Representations, Warranties,
        and Responsibilities), 9 (Disclaimers), 10 (Limitation of Liability), 11
        (Indemnification), and 12 (Governing Law) survive — including for outreach you
        previously sent through the Service.
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

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32 }}>11. Indemnification by You</h2>
      <p>
        You will defend, indemnify, and hold harmless BCHardy, its members, officers,
        employees, contractors, affiliates, licensors, and service providers from and
        against any and all third-party claims, demands, suits, actions, investigations,
        proceedings, and resulting losses, damages, liabilities, judgments, settlements,
        fines, penalties, regulatory assessments, statutory damages, and costs (including
        reasonable attorneys' fees and expenses) arising out of or relating to:
      </p>
      <ul>
        <li>
          The contact data (names, phone numbers, email addresses, consent records, lead
          metadata, or any other personal information) that you or anyone using your
          account uploads, imports, syncs, or otherwise processes through the Service —
          including any claim that the data was not lawfully obtained or that the source
          of the data did not permit its use for SMS outreach.
        </li>
        <li>
          Any claim that an individual contacted through the Service did not provide the
          consent required by the TCPA, a state-law equivalent, CAN-SPAM, carrier policy,
          CTIA guidelines, or any other applicable law or contract; or that consent was
          revoked and not honored.
        </li>
        <li>
          Any opt-out, "STOP", do-not-contact, or revocation request that your dealership
          failed to honor (including those collected outside the Service).
        </li>
        <li>
          The content of any message your account sent or attempted to send through the
          Service.
        </li>
        <li>
          Any inaccurate, misleading, or unauthorized information you provided for 10DLC /
          carrier campaign registration.
        </li>
        <li>
          Your breach or alleged breach of any representation, warranty, or obligation in
          Section 5 (Representations, Warranties, and Responsibilities) or any other
          provision of these Terms.
        </li>
        <li>
          Your violation or alleged violation of any law, regulation, or carrier policy,
          including the TCPA, state telephone-consumer-protection statutes, CAN-SPAM,
          the FTC Act, state UDAP / unfair-trade-practice statutes, and consumer-privacy
          laws (CCPA, state privacy acts, etc.).
        </li>
      </ul>
      <p>
        BCHardy will promptly notify you of any claim covered by this section, will
        reasonably cooperate with your defense at your expense, and may participate in the
        defense with counsel of its choosing. You will not settle any claim that imposes
        any obligation or admission on BCHardy without BCHardy's prior written consent.
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
