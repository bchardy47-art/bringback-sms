'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
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

// Plan-card content. Outcome-led: price up top, bullets describe who the
// tier is for, the cap line carries the volume constraint at lower
// visual weight. Pro's price is a "starting at" so the dealer sees a real
// number — custom volume is a sales-call conversation after activation.
type PlanCard = {
  id: Plan
  name: string
  price: string
  bullets: string[]
  cap: string
}

const PLANS: PlanCard[] = [
  {
    id: 'pilot',
    name: 'Pilot',
    price: '$199 / mo',
    bullets: ['Best for first store launch', 'Prove ROI fast'],
    cap: 'Up to 250 leads / month',
  },
  {
    id: 'standard',
    name: 'Standard',
    price: '$499 / mo',
    bullets: ['For consistent monthly reactivation', 'Built for active rooftops'],
    cap: 'Up to 1,000 leads / month',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 'From $999 / mo',
    bullets: ['For large stores and dealer groups', 'Priority support + custom volume'],
    cap: 'Custom volume',
  },
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
      {/* Plan picker — three outcome-led cards. Price up top, cap (volume
          line) at lower visual weight so the page reads as "pick the
          level that matches your store", not "pick a lead-quota tier". */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-sm font-semibold text-gray-800 mb-3">Choose your plan</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" id="plan-picker">
          {PLANS.map((p) => {
            const active = plan === p.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPlan(p.id)}
                aria-pressed={active}
                className={`text-left p-4 rounded-xl border transition-colors flex flex-col ${
                  active
                    ? 'border-red-500 ring-2 ring-red-500/30 bg-red-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <span className="block text-base font-bold text-gray-900">{p.name}</span>
                <span
                  className={`block mt-0.5 text-sm font-semibold ${
                    active ? 'text-red-600' : 'text-gray-900'
                  }`}
                >
                  {p.price}
                </span>
                <ul className="mt-2.5 space-y-1.5 flex-1">
                  {p.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2">
                      <Check
                        size={13}
                        strokeWidth={2.5}
                        className={`mt-0.5 flex-shrink-0 ${active ? 'text-red-500' : 'text-gray-400'}`}
                      />
                      <span className="text-xs leading-snug text-gray-700">{b}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 pt-3 border-t border-gray-100 text-[11px] uppercase tracking-wide font-medium text-gray-500">
                  {p.cap}
                </p>
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Card on file at activation.{' '}
          <strong className="font-semibold">
            First charge starts when your campaign is approved and live with the carriers
          </strong>{' '}
          (typically 7–10 business days).
        </p>
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
            {/* type="text" (not "url") so the browser doesn't block
                bare-domain inputs. Server normalizes the value — see
                /lib/normalize-website.ts and the activate route. */}
            <input
              id="website"
              name="website"
              type="text"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="smithhonda.com"
              required
              className={inputClass}
            />
            <p className="text-xs text-gray-400 mt-1">
              Bare domains are fine — we&apos;ll add <span className="font-mono">https://</span> if missing.
            </p>
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

      {/* Acceptance — single checkbox, but the label surfaces the binding
          dealer warranties at the moment of click so consent is informed.
          The full warranties live in /terms Section 5 and indemnity in
          Section 11; this is the in-product summary. Recorded with
          terms_version + terms_accepted_at on submit. */}
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
            By checking this box and clicking <strong>Activate account</strong>, on
            behalf of my dealership I agree to the{' '}
            <a href="/terms" target="_blank" className="text-red-600 underline">
              Terms of Service
            </a>{' '}
            (including the dealer warranties and indemnification in Sections 5 and 11),
            the{' '}
            <a href="/privacy" target="_blank" className="text-red-600 underline">
              Privacy Policy
            </a>
            , and the{' '}
            <a href="/sms-terms" target="_blank" className="text-red-600 underline">
              SMS Terms
            </a>
            . I represent and warrant that:
            <span className="block mt-2 pl-3 border-l-2 border-gray-200 text-xs text-gray-600 space-y-1">
              <span className="block">• I am authorized to bind my dealership.</span>
              <span className="block">
                • All lead and contact data we upload to DLR was lawfully obtained, and
                each individual we contact has provided the consent required by law and
                carrier policy.
              </span>
              <span className="block">
                • My dealership is the sender of record for our outreach. DLR is the
                software we use to send it.
              </span>
              <span className="block">
                • We will honor every opt-out, STOP, and do-not-contact request —
                including those collected outside DLR — and will not re-contact opted-out
                individuals.
              </span>
              <span className="block">
                • My dealership indemnifies BCHardy LLC for claims arising from our data,
                our consent records, or our use of the Service.
              </span>
            </span>
            <span className="block mt-3">
              I also consent to text-message communications from DLR at the mobile number
              above. Msg &amp; data rates may apply. Reply STOP to opt out.
            </span>
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
