'use client'

import { useState } from 'react'

// Approval-focused Stage 2 setup form.
//
// What this page collects, in four sections:
//   1. Business verification     -- legal name, EIN, dealership name,
//                                    website, full business address
//                                    (required for carrier registration)
//   2. Primary contact           -- name, email, phone, CRM system
//   3. Messaging compliance      -- lead source, consent, monthly volume,
//                                    approved sender name, TCPA ack
//   4. Optional launch prefs     -- starter-messaging toggle (+ optional
//                                    notes if unchecked), plus a small
//                                    bundle of fully-optional ops fields
//                                    (sales manager, store phone, tz,
//                                    business hours)
//
// What was removed from this page vs. the prior form (still on the row
// in the DB if Stage 1 set them; can be edited via admin tools):
//   - alertEmail / alertPhone   -- Stage 1 captured contact email + mobile
//   - sampleMessage1/2          -- replaced by the "use recommended"
//                                  pattern in section 4
//   - templateReviewAgreed      -- subsumed by complianceAgreed (TCPA)
//   - preferredWorkflowTypes    -- defaults applied; no per-dealer pick

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
]

const CRM_OPTIONS = [
  'VinSolutions',
  'DealerSocket',
  'Dealertrack',
  'Reynolds & Reynolds',
  'CDK Global',
  'Other',
]

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {hint && <p className="text-xs text-gray-400 mb-1.5">{hint}</p>}
      {children}
    </div>
  )
}

const inputClass =
  'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent'

function Input({
  name,
  placeholder,
  type = 'text',
  required,
  defaultValue,
}: {
  name: string
  placeholder?: string
  type?: string
  required?: boolean
  defaultValue?: string
}) {
  return (
    <input
      name={name}
      type={type}
      placeholder={placeholder}
      required={required}
      defaultValue={defaultValue}
      className={inputClass}
    />
  )
}

function Textarea({
  name,
  placeholder,
  rows = 4,
  required,
  defaultValue,
}: {
  name: string
  placeholder?: string
  rows?: number
  required?: boolean
  defaultValue?: string
}) {
  return (
    <textarea
      name={name}
      placeholder={placeholder}
      rows={rows}
      required={required}
      defaultValue={defaultValue}
      className={`${inputClass} resize-y`}
    />
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      <div>
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
        {description && <p className="text-sm text-gray-500 mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
}

// Defaults the Stage 2 form pre-populates from the existing intake row.
// Stage 1 already captured dealershipName / contact / mobile / website /
// store address — those defaults flow in here so the dealer doesn't have
// to retype anything. Compliance writeups are also threaded so the dealer
// sees their prior submission on reload (not the generic default text).
export type IntakeFormInitial = {
  dealershipName?: string | null
  businessWebsite?: string | null
  businessAddress?: string | null
  primaryContactName?: string | null
  primaryContactEmail?: string | null
  primaryContactPhone?: string | null
  alertEmail?: string | null
  alertPhone?: string | null
  crmSystem?: string | null
  leadSourceExplanation?: string | null
  consentExplanation?: string | null
}

// Default carrier-compliance language pre-filled into the two textareas
// in Section 3. Most dealers don't have practiced wording on hand for
// these prompts; staring at a blank box slows completion and produces
// uneven submissions. Dealers can edit or replace; the fields remain
// required so a blank cleared box still trips validation. These strings
// are the dealer-facing fallback only — the binding compliance + TCPA
// language lives in /terms Section 5.
const DEFAULT_LEAD_SOURCE_EXPLANATION =
  "These leads came from customers who submitted inquiry forms on our website or third-party automotive marketplaces requesting information about specific vehicles. They provided their contact information and expressed interest in purchasing or leasing."
const DEFAULT_CONSENT_EXPLANATION =
  "When customers submit an inquiry form, they agree to our terms and provide consent to receive follow-up SMS communications regarding their vehicle inquiry. Opt-out instructions are included in every message, and consent records are maintained by the dealership."

export function IntakeForm({
  token,
  dealershipName,
  initial,
}: {
  token: string
  dealershipName: string
  initial?: IntakeFormInitial
}) {
  const d = initial ?? {}
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  // Default-on. When unchecked, a notes textarea reveals so the dealer
  // can convey customizations for ops to review pre-launch.
  const [useRecommendedMessaging, setUseRecommendedMessaging] = useState(true)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    const form = new FormData(e.currentTarget)
    const data: Record<string, unknown> = {}
    Array.from(form.entries()).forEach(([k, v]) => {
      data[k] = v
    })
    // If the dealer kept the recommended-messaging default checked,
    // there's no notes textarea -- drop any stale value just in case.
    if (useRecommendedMessaging) {
      delete data.dealerMessagingNotes
    }

    try {
      const res = await fetch(`/api/intake/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Something went wrong. Please try again.')
      }
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
        <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 13l4 4L19 7"
              stroke="#16a34a"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Submitted — thank you!</h2>
        <p className="text-sm text-gray-500 max-w-sm mx-auto">
          We&apos;ve received your dealership information. Our team will reach out shortly
          to register your campaign with carriers and walk you through your kickoff.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ── 1. Business verification ──────────────────────────────────── */}
      <Section
        title="Business verification"
        description="What carriers require to approve your campaign. Stage 1 fields are pre-filled — edit only if needed."
      >
        <Row>
          <Field label="Legal Business Name" required hint="IRS-registered legal entity name">
            <Input name="businessLegalName" placeholder="Smith Automotive Group LLC" required />
          </Field>
          <Field label="EIN / Tax ID" required hint="9-digit federal tax ID (XX-XXXXXXX)">
            <Input name="ein" placeholder="12-3456789" required />
          </Field>
        </Row>
        <Row>
          <Field label="Dealership / Rooftop Name">
            <Input name="dealershipName" placeholder="Smith Honda" defaultValue={dealershipName} />
          </Field>
          <Field label="Business Website">
            <Input
              name="businessWebsite"
              type="url"
              placeholder="https://smithhonda.com"
              defaultValue={d.businessWebsite ?? ''}
            />
          </Field>
        </Row>
        <Field label="Full Business Address">
          <textarea
            name="businessAddress"
            placeholder="123 Auto Row Blvd, Springfield, IL 62701"
            rows={2}
            defaultValue={d.businessAddress ?? ''}
            className={`${inputClass} resize-y`}
          />
        </Field>
      </Section>

      {/* ── 2. Primary contact ─────────────────────────────────────────── */}
      <Section
        title="Primary contact"
        description="Who we talk to about this account. Pre-filled from activation."
      >
        <Row>
          <Field label="Name">
            <Input
              name="primaryContactName"
              placeholder="Jane Smith"
              defaultValue={d.primaryContactName ?? ''}
            />
          </Field>
          <Field label="Email">
            <Input
              name="primaryContactEmail"
              type="email"
              placeholder="jane@smithhonda.com"
              defaultValue={d.primaryContactEmail ?? ''}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Phone">
            <Input
              name="primaryContactPhone"
              type="tel"
              placeholder="(555) 123-4567"
              defaultValue={d.primaryContactPhone ?? ''}
            />
          </Field>
          <Field label="CRM System">
            <select
              name="crmSystem"
              defaultValue={d.crmSystem ?? ''}
              className={inputClass}
            >
              <option value="">Select CRM…</option>
              {CRM_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </Row>
      </Section>

      {/* ── 3. Messaging compliance ──────────────────────────────────── */}
      <Section
        title="Messaging compliance"
        description="Submitted verbatim to carrier registration (10DLC). Be specific — these are the answers carriers read."
      >
        <Field
          label="Lead source explanation"
          required
          hint="How did these leads originally contact your dealership? Pre-filled with standard language — edit if it doesn't match your store."
        >
          <Textarea
            name="leadSourceExplanation"
            rows={5}
            required
            defaultValue={d.leadSourceExplanation ?? DEFAULT_LEAD_SOURCE_EXPLANATION}
          />
        </Field>
        <Field
          label="Consent explanation"
          required
          hint="How do customers agree to receive SMS from your dealership? Pre-filled with standard language — edit if it doesn't match your store."
        >
          <Textarea
            name="consentExplanation"
            rows={5}
            required
            defaultValue={d.consentExplanation ?? DEFAULT_CONSENT_EXPLANATION}
          />
        </Field>
        <Row>
          <Field
            label="Estimated monthly SMS volume"
            hint="Approximate outbound messages per month"
          >
            <Input name="expectedMonthlyVolume" type="number" placeholder="500" />
          </Field>
          <Field
            label="Approved sender name"
            hint="What appears in texts (e.g. 'Brian at Smith Honda')"
          >
            <Input name="approvedSenderName" placeholder="Brian at Smith Honda" />
          </Field>
        </Row>
        <label className="flex items-start gap-3 cursor-pointer pt-1">
          <input
            type="checkbox"
            name="complianceAgreed"
            value="true"
            defaultChecked
            className="mt-1 accent-red-600"
          />
          <span className="text-sm text-gray-700">
            All outreach will include opt-out language and will be TCPA-compliant.
            <span className="block text-xs text-gray-400 mt-0.5">
              Acknowledged at activation — confirmed here for the carrier record.
            </span>
          </span>
        </label>
      </Section>

      {/* ── 4. Optional launch preferences ───────────────────────────── */}
      <Section
        title="Launch preferences"
        description="Optional. Sensible defaults apply if you skip this section — we'll calibrate on your kickoff call."
      >
        {/* Recommended-messaging toggle. Default on -- this is the path
            most dealers take. When unchecked we reveal a single notes
            textarea so they can convey custom intent without forcing
            them to author messages. */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={useRecommendedMessaging}
            onChange={(e) => setUseRecommendedMessaging(e.target.checked)}
            className="mt-1 accent-red-600"
          />
          <span className="text-sm text-gray-700">
            <span className="font-semibold">Use our recommended starter messaging.</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Calibrated automotive re-engagement copy tuned per age window. We&apos;ll
              review the exact wording with you before any sends.
            </span>
          </span>
        </label>

        {!useRecommendedMessaging && (
          <Field
            label="Messaging notes"
            hint="What would you like to do differently? (Optional — we&apos;ll discuss on your kickoff call.)"
          >
            <Textarea
              name="dealerMessagingNotes"
              placeholder="e.g. Use a casual tone. Avoid pricing mentions. Always reference the model. Don't use exclamation points."
              rows={3}
            />
          </Field>
        )}

        <Row>
          <Field label="Sales manager name">
            <Input name="salesManagerName" placeholder="Mike Johnson" />
          </Field>
          <Field label="Main store phone">
            <Input name="storePhone" type="tel" placeholder="(555) 111-2222" />
          </Field>
        </Row>
        <Row>
          <Field label="Timezone" hint="We can infer from your address if you skip this.">
            <select name="timezone" className={inputClass}>
              <option value="">Select timezone…</option>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace('America/', '').replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Business hours" hint="e.g. Mon–Fri 9am–8pm, Sat 9am–5pm">
            <Input name="businessHours" placeholder="Mon–Fri 9am–8pm, Sat 9am–5pm" />
          </Field>
        </Row>
      </Section>

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
        {submitting ? 'Submitting…' : 'Save setup details →'}
      </button>

      <p className="text-xs text-gray-400 text-center pb-6">
        You can save what you have and finish the rest later — your account is already activated.
      </p>
    </form>
  )
}
