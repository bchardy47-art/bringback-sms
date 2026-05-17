'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TERMS_VERSION } from '@/lib/legal'

// Stage 1 — Activation / Close.
//   Goal: capture the deal in 60–90 seconds.
//   What we collect here is the minimum to (a) identify the dealership,
//   (b) reach the buyer, (c) acknowledge legal terms, (d) reserve the
//   account, and (e) record the chosen plan. The long-form onboarding
//   (EIN, 10DLC writeups, sample messages, workflow types, etc.) is
//   handled in Stage 2 *after* commitment.

const CRM_OPTIONS = [
  'VinSolutions',
  'DealerSocket',
  'Dealertrack',
  'Reynolds & Reynolds',
  'CDK Global',
  'Other',
  'Not sure / skip',
]

type Plan = 'pilot' | 'standard' | 'pro'

const PLANS: { id: Plan; name: string; tagline: string }[] = [
  { id: 'pilot',    name: 'Pilot',    tagline: 'First 100 leads, prove ROI' },
  { id: 'standard', name: 'Standard', tagline: 'Up to 1,000 leads / month' },
  { id: 'pro',      name: 'Pro',      tagline: 'Unlimited leads, priority support' },
]

const inputClass =
  'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent'

export function ActivationForm({
  token,
  dealershipName,
}: {
  token: string
  dealershipName: string
}) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [plan, setPlan] = useState<Plan>('pilot')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')

    const form = new FormData(e.currentTarget)
    const data: Record<string, unknown> = {}
    Array.from(form.entries()).forEach(([k, v]) => {
      data[k] = v
    })
    data.plan = plan
    // Tell the server exactly which version of the Terms the dealer
    // is agreeing to right now, so it can be recorded in the audit trail.
    data.termsVersion = TERMS_VERSION

    try {
      const res = await fetch(`/api/intake/${token}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Something went wrong. Please try again.')
      }
      // Push into the payment step. The page-level router will detect
      // activatedAt on reload and show the next stage.
      router.replace(`/intake/${token}/payment`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Plan picker */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-sm font-semibold text-gray-800 mb-3">Plan</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {PLANS.map((p) => {
            const active = plan === p.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPlan(p.id)}
                aria-pressed={active}
                className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${
                  active
                    ? 'border-red-500 ring-2 ring-red-500/30 bg-red-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <span className="block text-sm font-semibold text-gray-900">{p.name}</span>
                <span className="block text-xs text-gray-500 mt-0.5">{p.tagline}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Identity */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div>
          <label htmlFor="dealershipName" className="block text-sm font-semibold text-gray-800 mb-1">
            Dealership name <span className="text-red-500">*</span>
          </label>
          <input
            id="dealershipName"
            name="dealershipName"
            defaultValue={dealershipName}
            placeholder="Smith Honda"
            required
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="contactName" className="block text-sm font-semibold text-gray-800 mb-1">
              Your name <span className="text-red-500">*</span>
            </label>
            <input
              id="contactName"
              name="contactName"
              autoComplete="name"
              placeholder="Jane Smith"
              required
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="contactEmail" className="block text-sm font-semibold text-gray-800 mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              id="contactEmail"
              name="contactEmail"
              type="email"
              autoComplete="email"
              placeholder="jane@smithhonda.com"
              required
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="contactMobile" className="block text-sm font-semibold text-gray-800 mb-1">
              Mobile <span className="text-red-500">*</span>
            </label>
            <input
              id="contactMobile"
              name="contactMobile"
              type="tel"
              autoComplete="tel"
              placeholder="(555) 987-6543"
              required
              className={inputClass}
            />
            <p className="text-xs text-gray-400 mt-1">Confirmation + revival alerts.</p>
          </div>
          <div>
            <label htmlFor="website" className="block text-sm font-semibold text-gray-800 mb-1">
              Website <span className="text-red-500">*</span>
            </label>
            <input
              id="website"
              name="website"
              type="url"
              placeholder="https://smithhonda.com"
              required
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="storeAddress" className="block text-sm font-semibold text-gray-800 mb-1">
            Store address <span className="text-red-500">*</span>
          </label>
          <input
            id="storeAddress"
            name="storeAddress"
            autoComplete="street-address"
            placeholder="123 Auto Row Blvd, Springfield, IL 62701"
            required
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="crmSystem" className="block text-sm font-semibold text-gray-800 mb-1">
            CRM <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <select id="crmSystem" name="crmSystem" className={inputClass}>
            <option value="">Select CRM…</option>
            {CRM_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Consent — single checkbox covering ToS (which incorporates Privacy
          and SMS Terms by reference). This is the standard SaaS pattern;
          adding three checkboxes would re-introduce friction. */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            name="termsAgreed"
            value="true"
            required
            className="mt-1 accent-red-600"
          />
          <span className="text-sm text-gray-700 leading-relaxed">
            I agree to the{' '}
            <a href="/terms" target="_blank" className="text-red-600 underline">
              Terms of Service
            </a>{' '}
            (which cover subscription billing through DLR / BCHardy LLC). I have read
            the{' '}
            <a href="/privacy" target="_blank" className="text-red-600 underline">
              Privacy Policy
            </a>{' '}
            and{' '}
            <a href="/sms-terms" target="_blank" className="text-red-600 underline">
              SMS Terms
            </a>
            , and I consent to text-message communications from DLR at the number above.
            Msg &amp; data rates may apply. Reply STOP to opt out.
          </span>
        </label>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3.5 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-60"
        style={{ backgroundColor: '#dc2626' }}
      >
        {submitting ? 'Activating…' : 'Activate account →'}
      </button>

      <p className="text-xs text-gray-400 text-center">
        Takes about a minute. Full setup details come after activation.
      </p>
    </form>
  )
}
