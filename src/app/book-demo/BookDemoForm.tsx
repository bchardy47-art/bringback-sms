'use client'

import { useState, useTransition } from 'react'
import { submitBookDemo } from './actions'

type Fields = {
  dealershipName:    string
  decisionMakerName: string
  phone:             string
  email:             string
}

type Errors = Partial<Record<keyof Fields, string>>

function validate(fields: Fields): Errors {
  const e: Errors = {}
  if (!fields.dealershipName.trim())    e.dealershipName    = 'Enter the dealership name.'
  if (!fields.decisionMakerName.trim()) e.decisionMakerName = "Enter the decision maker's name."
  if (fields.phone.replace(/\D/g, '').length < 7) e.phone  = 'Enter a valid phone number.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim())) e.email = 'Enter a valid email address.'
  return e
}

const FIELDS: Array<{
  key: keyof Fields
  label: string
  type: string
  placeholder: string
  autoComplete: string
}> = [
  { key: 'dealershipName',    label: 'Dealership Name',       type: 'text',  placeholder: 'e.g. Smith Honda',        autoComplete: 'organization' },
  { key: 'decisionMakerName', label: 'Decision Maker Name',   type: 'text',  placeholder: 'e.g. John Smith',         autoComplete: 'name' },
  { key: 'phone',             label: 'Phone Number',           type: 'tel',   placeholder: 'e.g. (555) 000-0000',     autoComplete: 'tel' },
  { key: 'email',             label: 'Email Address',          type: 'email', placeholder: 'e.g. john@smithhonda.com', autoComplete: 'email' },
]

export function BookDemoForm() {
  const [fields, setFields] = useState<Fields>({
    dealershipName:    '',
    decisionMakerName: '',
    phone:             '',
    email:             '',
  })
  const [errors,      setErrors]      = useState<Errors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [isSuccess,   setIsSuccess]   = useState(false)
  const [isPending,   startTransition] = useTransition()

  function set(key: keyof Fields) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setFields(prev => ({ ...prev, [key]: e.target.value }))
      if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }))
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate(fields)
    if (Object.keys(errs).length > 0) { setErrors(errs); return }
    setErrors({})
    setServerError(null)
    startTransition(async () => {
      const result = await submitBookDemo({
        dealershipName:    fields.dealershipName.trim(),
        decisionMakerName: fields.decisionMakerName.trim(),
        phone:             fields.phone.trim(),
        email:             fields.email.trim().toLowerCase(),
      })
      if (result.ok) {
        setIsSuccess(true)
      } else {
        setServerError(result.error ?? 'Something went wrong. Please try again.')
      }
    })
  }

  if (isSuccess) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 20px' }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
          fontSize: 24,
        }}>
          ✓
        </div>
        <p style={{ fontSize: 18, fontWeight: 700, color: '#4ade80', marginBottom: 8 }}>
          Demo request received.
        </p>
        <p style={{ fontSize: 14, color: 'var(--tx-mid)', lineHeight: 1.6 }}>
          We&rsquo;ll reach out shortly.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {FIELDS.map(({ key, label, type, placeholder, autoComplete }) => (
        <div key={key}>
          <label
            htmlFor={`book-demo-${key}`}
            style={{
              display: 'block', fontSize: 11, fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              color: errors[key] ? '#ff8a7a' : 'var(--tx-lo)',
              marginBottom: 6,
            }}
          >
            {label}
          </label>
          <input
            id={`book-demo-${key}`}
            type={type}
            autoComplete={autoComplete}
            value={fields[key]}
            onChange={set(key)}
            placeholder={placeholder}
            className="dlr-input"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              borderColor: errors[key] ? 'rgba(255,90,90,0.5)' : undefined,
            }}
          />
          {errors[key] && (
            <p style={{ margin: '5px 0 0', fontSize: 12, color: '#ff8a7a' }}>
              {errors[key]}
            </p>
          )}
        </div>
      ))}

      {serverError && (
        <p style={{
          margin: 0, fontSize: 13, color: '#ff8a7a',
          padding: '10px 14px',
          background: 'rgba(255,42,42,0.08)',
          border: '1px solid rgba(255,42,42,0.25)',
          borderRadius: 8,
        }}>
          {serverError}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="dlr-btn-primary"
        style={{
          marginTop: 4,
          width: '100%',
          opacity: isPending ? 0.6 : 1,
          cursor: isPending ? 'not-allowed' : 'pointer',
        }}
      >
        {isPending ? 'Sending…' : 'BOOK MY DEMO'}
      </button>
    </form>
  )
}
