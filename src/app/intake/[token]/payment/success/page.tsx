import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dealerIntakes } from '@/lib/db/schema'
import { isStripeConfigured, stripeOrThrow } from '@/lib/stripe'

// /intake/[token]/payment/success?session_id=cs_...
//
// Stripe redirects here after a successful Checkout Session. We re-fetch
// the session server-side so we can trust the result — we never rely on
// the URL alone to mark anything paid.
//
// Webhooks are a stronger guarantee and the right long-term answer
// (covers async settle and customer.subscription.* lifecycle events) —
// flagged as a follow-up. For first-pass, server-verified-on-redirect
// is the next-best primitive.

export default async function PaymentSuccessPage({
  params,
  searchParams,
}: {
  params: { token: string }
  searchParams: { session_id?: string }
}) {
  const intake = await db.query.dealerIntakes.findFirst({
    where: eq(dealerIntakes.token, params.token),
  })
  if (!intake) notFound()
  if (!intake.activatedAt) redirect(`/intake/${params.token}`)

  const sessionId = searchParams.session_id
  let paid = false
  let verifyError: string | null = null

  if (!sessionId) {
    verifyError = 'Missing session id from Stripe.'
  } else if (!isStripeConfigured()) {
    verifyError = 'Stripe is not configured on this environment.'
  } else {
    try {
      const stripe = stripeOrThrow()
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['subscription', 'customer'],
      })

      // Defense against tampering: the session must reference this intake.
      const sessionMatchesIntake =
        session.client_reference_id === intake.token ||
        session.metadata?.token === intake.token
      if (!sessionMatchesIntake) {
        verifyError = 'Payment session does not match this intake.'
      } else if (session.payment_status === 'paid' || session.status === 'complete') {
        // Persist the verified result. Idempotent — re-running is fine.
        const customerId =
          typeof session.customer === 'string'
            ? session.customer
            : session.customer?.id ?? null
        const subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id ?? null

        await db
          .update(dealerIntakes)
          .set({
            paymentStatus:           'paid',
            stripeCustomerId:        customerId ?? intake.stripeCustomerId,
            stripeSubscriptionId:    subscriptionId ?? intake.stripeSubscriptionId,
            stripeCheckoutSessionId: session.id,
            updatedAt:               new Date(),
          })
          .where(eq(dealerIntakes.id, intake.id))
        paid = true
      } else {
        verifyError = `Stripe reports session status "${session.status}". Please try again.`
      }
    } catch (err) {
      console.error('[intake payment success]', err)
      verifyError = 'Could not verify the payment with Stripe.'
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center">
        {paid ? (
          <>
            <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M5 13l4 4L19 7" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Card on file</h1>
            <p className="text-sm text-gray-500">
              Your subscription is reserved and your card is on file. Your first charge
              will start when your campaign is approved and live with the carriers.
              Continue to setup to finish the carrier-required details.
            </p>
            <Link
              href={`/intake/${params.token}`}
              className="inline-block mt-5 px-5 py-2.5 rounded-xl text-sm font-bold text-white"
              style={{ backgroundColor: '#dc2626' }}
            >
              Continue to setup →
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-2">We couldn&apos;t verify the payment</h1>
            <p className="text-sm text-gray-500">
              {verifyError ?? 'Please try again or contact support.'}
            </p>
            <Link
              href={`/intake/${params.token}/payment`}
              className="inline-block mt-5 px-5 py-2.5 rounded-xl text-sm font-bold text-white"
              style={{ backgroundColor: '#1f2937' }}
            >
              Back to payment
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
