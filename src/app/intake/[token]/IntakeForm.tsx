'use client'

import { useState } from 'react'

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

function Field({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode
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

function Input({ name, placeholder, type = 'text', required, defaultValue }: {
  name: string; placeholder?: string; type?: string; required?: boolean; defaultValue?: string
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

function Textarea({ name, placeholder, rows = 4, required }: {
  name: string; placeholder?: string; rows?: number; required?: boolean
}) {
  return (
    <textarea
      name={name}
      placeholder={placeholder}
      rows={rows}
      required={required}
      className={`${inputClass} resize-y`}
    />
  )
}

function Section({ title, description, children }: {
  title: string; description?: string; children: React.ReactNode
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
// to retype anything.
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
}

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
  const [workflowTypes, setWorkflowTypes] = useState<string[]>([])

  function toggleWorkflow(val: string) {
    setWorkflowTypes(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    )
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    const form = new FormData(e.currentTarget)
    const data: Record<string, unknown> = {}
    Array.from(form.entries()).forEach(([k, v]) => { data[k] = v })
    data.preferredWorkflowTypes = workflowTypes

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
            <path d="M5 13l4 4L19 7" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Submitted — thank you!</h2>
        <p className="text-sm text-gray-500 max-w-sm mx-auto">
          We&apos;ve received your dealership information. Our team will reach out shortly to
          complete your DLR setup.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Section 1: Business identity.
          Only legal name + EIN are truly required (carrier 10DLC).
          Dealership name, website, address arrive pre-filled from Stage 1. */}
      <Section
        title="Business Information"
        description="Carrier 10DLC registration. Legal name and EIN are the carrier-required fields."
      >
        <Row>
          <Field label="Dealership / Rooftop Name" hint="Pre-filled from activation. Edit if needed.">
            <Input name="dealershipName" placeholder="Smith Honda" defaultValue={dealershipName} />
          </Field>
          <Field label="Legal Business Name" required hint="IRS-registered legal entity name">
            <Input name="businessLegalName" placeholder="Smith Automotive Group LLC" required />
          </Field>
        </Row>
        <Row>
          <Field label="EIN / Tax ID" required hint="9-digit federal tax ID (XX-XXXXXXX)">
            <Input name="ein" placeholder="12-3456789" required />
          </Field>
          <Field label="Business Website" hint="Pre-filled from activation.">
            <Input name="businessWebsite" placeholder="https://smithhonda.com" defaultValue={d.businessWebsite ?? ''} />
          </Field>
        </Row>
        <Field label="Full Business Address" hint="Pre-filled from activation. Edit if needed.">
          <textarea
            name="businessAddress"
            placeholder="123 Auto Row Blvd, Springfield, IL 62701"
            rows={2}
            defaultValue={d.businessAddress ?? ''}
            className={`${inputClass} resize-y`}
          />
        </Field>
      </Section>

      {/* Section 2: Contacts. All pre-filled from Stage 1 — optional in
          Stage 2 since the dealer already provided this at close. */}
      <Section
        title="Contacts"
        description="Pre-filled from activation. Add more contacts if you'd like — none are required at this stage."
      >
        <Row>
          <Field label="Primary Contact Name">
            <Input name="primaryContactName" placeholder="Jane Smith" defaultValue={d.primaryContactName ?? ''} />
          </Field>
          <Field label="Primary Contact Email">
            <Input name="primaryContactEmail" type="email" placeholder="jane@smithhonda.com" defaultValue={d.primaryContactEmail ?? ''} />
          </Field>
        </Row>
        <Row>
          <Field label="Primary Contact Phone">
            <Input name="primaryContactPhone" type="tel" placeholder="(555) 123-4567" defaultValue={d.primaryContactPhone ?? ''} />
          </Field>
          <Field label="Sales Manager Name">
            <Input name="salesManagerName" placeholder="Mike Johnson" />
          </Field>
        </Row>
        <Row>
          <Field label="Alert Email" hint="Optional — leave blank to reuse your primary contact email.">
            <Input name="alertEmail" type="email" placeholder="alerts@smithhonda.com" defaultValue={d.alertEmail ?? ''} />
          </Field>
          <Field label="Manager Mobile" hint="Pre-filled from activation. Gets an SMS when a lead replies.">
            <Input name="alertPhone" type="tel" placeholder="(555) 987-6543" defaultValue={d.alertPhone ?? ''} />
          </Field>
        </Row>
      </Section>

      {/* Section 3: Operations. All optional — CRM was already collected
          (optionally) in Stage 1; timezone can be inferred from address. */}
      <Section title="Operations" description="All optional. We can fill these in together if you skip them.">
        <Row>
          <Field label="Main Store Phone">
            <Input name="storePhone" type="tel" placeholder="(555) 111-2222" />
          </Field>
          <Field label="CRM System" hint="Pre-filled from activation if you set it.">
            <select
              name="crmSystem"
              defaultValue={d.crmSystem ?? ''}
              className={inputClass}
            >
              <option value="">Select CRM...</option>
              {CRM_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </Row>
        <Row>
          <Field label="Timezone">
            <select name="timezone" className={inputClass}>
              <option value="">Select timezone...</option>
              {TIMEZONES.map(tz => (
                <option key={tz} value={tz}>
                  {tz.replace('America/', '').replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Business Hours" hint="e.g. Mon–Fri 9am–8pm, Sat 9am–5pm">
            <Input name="businessHours" placeholder="Mon–Fri 9am–8pm, Sat 9am–5pm" />
          </Field>
        </Row>
      </Section>

      {/* Section 4: Compliance */}
      <Section
        title="Compliance"
        description="These answers are submitted verbatim to carrier registration (10DLC). Be specific."
      >
        <Field
          label="Lead Source Explanation"
          required
          hint="How did these leads originally contact your dealership?"
        >
          <Textarea
            name="leadSourceExplanation"
            placeholder="Leads in our database submitted inquiry forms on our website or third-party sites (AutoTrader, Cars.com) requesting information about specific vehicles. They provided their contact info and expressed interest in purchasing or leasing."
            rows={5}
            required
          />
        </Field>
        <Field
          label="Consent Explanation"
          required
          hint="How do customers agree to receive SMS from your dealership?"
        >
          <Textarea
            name="consentExplanation"
            placeholder="When customers submit an inquiry form, they agree to our terms of service which include consent to receive SMS communications regarding their vehicle inquiry. Opt-out instructions are included in every message."
            rows={5}
            required
          />
        </Field>
        <Field label="Estimated Monthly SMS Volume" hint="Approximate number of outbound messages per month">
          <Input name="expectedMonthlyVolume" type="number" placeholder="500" />
        </Field>
      </Section>

      {/* Section 5: Campaign setup */}
      <Section
        title="Campaign Setup"
        description="How you want your revival outreach structured."
      >
        <Field label="Lead Types to Target">
          <div className="space-y-2">
            {[
              { value: 'stale', label: 'Stale leads', desc: 'Went quiet after initial contact' },
              { value: 'orphaned', label: 'Orphaned leads', desc: 'No longer assigned to a salesperson' },
            ].map(({ value, label, desc }) => (
              <label
                key={value}
                className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={workflowTypes.includes(value)}
                  onChange={() => toggleWorkflow(value)}
                  className="mt-0.5 accent-red-600"
                />
                <div>
                  <p className="text-sm font-semibold text-gray-800">{label}</p>
                  <p className="text-xs text-gray-500">{desc}</p>
                </div>
              </label>
            ))}
          </div>
        </Field>
        <Field
          label="Sample Message 1"
          hint="A message you'd send to a stale lead. We'll refine the copy together."
        >
          <Textarea
            name="sampleMessage1"
            placeholder="Hi [Name], this is [Agent] from Smith Honda. You reached out about the [Vehicle] a while back — still interested? We have some new incentives. Reply STOP to opt out."
            rows={4}
          />
        </Field>
        <Field label="Sample Message 2" hint="A follow-up or alternate message">
          <Textarea
            name="sampleMessage2"
            placeholder="Hey [Name] — just checking in from Smith Honda. The [Vehicle] you were looking at is still available and we have a great offer this month. Want to come in? Reply STOP to opt out."
            rows={4}
          />
        </Field>
      </Section>

      {/* Section 6: Agreements */}
      <Section title="Agreements">
        <Field label="Approved Sender Name" hint="The name that appears in texts (e.g. 'Brian at Smith Honda')">
          <Input name="approvedSenderName" placeholder="Brian at Smith Honda" />
        </Field>
        <div className="space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" name="templateReviewAgreed" value="true" className="mt-1 accent-red-600" required />
            <span className="text-sm text-gray-700">
              I agree to review and approve all message templates before any texts are sent to our customers.
            </span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" name="complianceAgreed" value="true" defaultChecked className="mt-1 accent-red-600" />
            <span className="text-sm text-gray-700">
              I understand that all outreach will include opt-out language and will be TCPA-compliant.
              <span className="block text-xs text-gray-400 mt-0.5">Already acknowledged at activation — left checked for reference.</span>
            </span>
          </label>
        </div>
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
