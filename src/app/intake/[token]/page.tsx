import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dealerIntakes } from '@/lib/db/schema'
import { ActivationForm } from './ActivationForm'
import { IntakeForm } from './IntakeForm'

// Intake state machine.
//   submittedAt set                   → all done, show success
//   !activatedAt                      → show Stage 1 (activation/close)
//   billing not complete              → bounce to /payment
//                                       (any payment_status other than
//                                       'paid' or 'manual_billing' counts
//                                       as not-complete)
//   else                              → show Stage 2 (full onboarding)
//
// Self-serve dealers reach 'paid' by completing Stripe Checkout.
// Admins can set 'manual_billing' on a row (SQL or future admin action)
// to allow a known dealer to finish setup without going through Checkout
// — this is the supported, controlled out-of-band billing path.

export default async function IntakePage({
  params,
}: {
  params: { token: string }
}) {
  const intake = await db.query.dealerIntakes.findFirst({
    where: eq(dealerIntakes.token, params.token),
  })
  if (!intake) notFound()

  if (intake.submittedAt) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M5 13l4 4L19 7" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">You&apos;re all set!</h1>
          <p className="text-sm text-gray-500">
            We received your dealership information. Our team will be in touch shortly to
            complete your setup.
          </p>
        </div>
      </div>
    )
  }

  // Stage 1 — activation/close.
  if (!intake.activatedAt) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-2xl mx-auto px-6 py-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-red-600 uppercase tracking-widest mb-0.5">
                Dead Lead Revival
              </p>
              <h1 className="text-lg font-bold text-gray-900">Activate your account</h1>
            </div>
            <span className="text-xs text-gray-400">Step 1 of 3</span>
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-6 py-8">
          <ActivationForm
            token={params.token}
            dealershipName={intake.dealershipName ?? ''}
          />
        </div>
      </div>
    )
  }

  // Stage 2 access requires a completed billing state. Any value other
  // than 'paid' (real Stripe subscription, including the trialing
  // billing-delay window) or 'manual_billing' (admin-flagged out-of-band
  // arrangement) sends the dealer back to /payment. This catches
  // 'pending', 'awaiting_stripe', 'skipped' (legacy rows), 'past_due',
  // and 'cancelled'.
  const billingComplete =
    intake.paymentStatus === 'paid' || intake.paymentStatus === 'manual_billing'
  if (!billingComplete) {
    redirect(`/intake/${params.token}/payment`)
  }

  // Stage 2 — full onboarding. The long form lives in IntakeForm.
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-red-600 uppercase tracking-widest mb-0.5">
              Dead Lead Revival
            </p>
            <h1 className="text-lg font-bold text-gray-900">Finish your setup</h1>
            <p className="text-xs text-gray-500 mt-1">
              You can complete this anytime — your account is already activated.
            </p>
          </div>
          <span className="text-xs text-gray-400">Step 3 of 3</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8">
        <IntakeForm
          token={params.token}
          dealershipName={intake.dealershipName ?? ''}
          initial={{
            dealershipName:        intake.dealershipName,
            businessWebsite:       intake.businessWebsite,
            businessAddress:       intake.businessAddress,
            primaryContactName:    intake.primaryContactName,
            primaryContactEmail:   intake.primaryContactEmail,
            primaryContactPhone:   intake.primaryContactPhone,
            alertEmail:            intake.alertEmail,
            alertPhone:            intake.alertPhone,
            crmSystem:             intake.crmSystem,
            // If the dealer already submitted compliance text, show
            // it on reload (don't overwrite with the prefilled defaults).
            leadSourceExplanation: intake.leadSourceExplanation,
            consentExplanation:    intake.consentExplanation,
          }}
        />
      </div>
    </div>
  )
}
