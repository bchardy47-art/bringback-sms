import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dealerIntakes } from '@/lib/db/schema'
import { IntakeForm } from './IntakeForm'

export default async function IntakePage({ params }: { params: { token: string } }) {
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
            We received your dealership information. Our team will be in touch shortly to complete
            your setup.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-red-600 uppercase tracking-widest mb-0.5">
              Dead Lead Revival
            </p>
            <h1 className="text-lg font-bold text-gray-900">Dealership Onboarding</h1>
          </div>
          <span className="text-xs text-gray-400">Step 1 of 1</span>
        </div>
      </div>

      {/* Form */}
      <div className="max-w-2xl mx-auto px-6 py-8">
        <IntakeForm token={params.token} dealershipName={intake.dealershipName ?? ''} />
      </div>
    </div>
  )
}
