import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dealerIntakes } from '@/lib/db/schema'
import { PaymentStepClient } from './PaymentStepClient'

// Stage 1.5 — Payment step.
//   This is the second screen of the activation flow. It is intentionally
//   small: chosen plan + one CTA. Stripe is not wired in this first pass
//   (no API keys yet); see PaymentStepClient for the exact slot where
//   Stripe Checkout / Payment Element will plug in.

export default async function PaymentPage({
  params,
  searchParams,
}: {
  params: { token: string }
  searchParams: { cancelled?: string }
}) {
  const intake = await db.query.dealerIntakes.findFirst({
    where: eq(dealerIntakes.token, params.token),
  })
  if (!intake) notFound()

  // If they haven't activated yet, bounce back to the activation form —
  // payment makes no sense before the deal is captured.
  if (!intake.activatedAt) redirect(`/intake/${params.token}`)

  // If they already completed the full onboarding, show the all-done page.
  if (intake.submittedAt) redirect(`/intake/${params.token}`)

  const cancelled = searchParams.cancelled === '1'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-red-600 uppercase tracking-widest mb-0.5">
              Dead Lead Revival
            </p>
            <h1 className="text-lg font-bold text-gray-900">Payment</h1>
          </div>
          <span className="text-xs text-gray-400">Step 2 of 3</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8">
        {cancelled && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 mb-4">
            <p className="text-sm text-amber-800">
              Checkout was cancelled — your card was not charged. You can try again or
              choose to set up billing later.
            </p>
          </div>
        )}
        <PaymentStepClient
          token={params.token}
          plan={intake.plan ?? 'pilot'}
          paymentStatus={intake.paymentStatus}
        />
      </div>
    </div>
  )
}
