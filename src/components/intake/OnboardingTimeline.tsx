/**
 * Short dealer-facing "what happens next" timeline used by the intake
 * activation form (Stage 1) and the payment step (Stage 1.5). Pure
 * presentational — no hooks, no client state — so it can be imported
 * by either server or client components.
 *
 * Pass `currentStep` (1-6) to mark the dealer's current location in the
 * flow; earlier steps render as done (emerald check), the current step
 * is highlighted in blue, later steps stay neutral gray.
 *
 * Copy is deliberately calm and dealer-friendly. The closing reassurance
 * line is the same trust-language used elsewhere in the onboarding flow
 * (dealer-invite landing page, payment step). Mobile-friendly: padding
 * scales p-4 sm:p-5; rows wrap label below the numbered circle on narrow
 * viewports via flex items-start.
 */

const STEPS: ReadonlyArray<string> = [
  'Complete dealership setup',
  'Add payment method',
  'DLR completes carrier registration and number setup',
  'Upload or approve lead import',
  'Review your first pilot batches',
  'DLR activates live sending with you',
]

export function OnboardingTimeline({
  currentStep,
}: {
  currentStep?: 1 | 2 | 3 | 4 | 5 | 6
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">What happens next</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          DLR is a guided setup. You stay in control before anything goes live.
        </p>
      </div>

      <ol className="space-y-1.5">
        {STEPS.map((label, idx) => {
          const num       = idx + 1
          const isCurrent = currentStep === num
          const isDone    = currentStep != null && num < currentStep
          return (
            <li
              key={num}
              className={`flex items-start gap-3 rounded-lg px-3 py-2 ${
                isCurrent ? 'bg-blue-50 border border-blue-200' : ''
              }`}
            >
              <span
                className={`flex-shrink-0 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold ${
                  isDone    ? 'bg-emerald-500 text-white' :
                  isCurrent ? 'bg-blue-600    text-white' :
                              'bg-gray-200    text-gray-500'
                }`}
                aria-hidden="true"
              >
                {isDone ? '✓' : num}
              </span>
              <p
                className={`text-sm leading-snug ${
                  isCurrent ? 'text-blue-900 font-semibold' :
                  isDone    ? 'text-gray-500' :
                              'text-gray-700'
                }`}
              >
                {label}
              </p>
            </li>
          )
        })}
      </ol>

      <p className="text-xs font-semibold text-emerald-700 pt-1">
        No customer messages send until the first campaign is reviewed and
        live-send activation is complete.
      </p>
    </div>
  )
}
