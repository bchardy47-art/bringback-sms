'use client'

import { useState } from 'react'

export const CONSENT_TEXT_VERSION = '2026-05-15-v1'

export const CONSENT_TEXT_SNAPSHOT =
  'By checking this box and submitting this form, I expressly consent to receive ' +
  'recurring automated marketing SMS text messages from BCHardy LLC (operating as ' +
  'Dead Lead Revival / DLR) at the mobile phone number provided above. Marketing ' +
  'messages may include follow-up communications regarding my vehicle purchase ' +
  'inquiry. Message frequency varies. Message and data rates may apply. Consent is ' +
  'not a condition of any purchase or service. Reply STOP at any time to unsubscribe. ' +
  'Reply HELP for assistance.'

type FormState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'error'; message: string }

export function SmsConsentForm() {
  const [state, setState] = useState<FormState>({ kind: 'idle' })

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)

    const consented = data.get('sms_consent') === 'on'
    if (!consented) {
      setState({ kind: 'error', message: 'Please check the consent box to opt in.' })
      return
    }

    setState({ kind: 'submitting' })

    try {
      const res = await fetch('/api/sms-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName:           String(data.get('first_name') ?? ''),
          lastName:            String(data.get('last_name') ?? ''),
          phone:               String(data.get('phone') ?? ''),
          vehicleOfInterest:   String(data.get('vehicle_interest') ?? '') || undefined,
          smsConsent:          true,
          consentTextVersion:  CONSENT_TEXT_VERSION,
          consentTextSnapshot: CONSENT_TEXT_SNAPSHOT,
          pageUrl:             typeof window !== 'undefined' ? window.location.href : undefined,
        }),
      })

      if (!res.ok) {
        const detail = await res.json().catch(() => null)
        const msg = detail?.error ?? `Submission failed (${res.status}). Please try again.`
        setState({ kind: 'error', message: msg })
        return
      }

      setState({ kind: 'success' })
      form.reset()
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Network error — please try again.',
      })
    }
  }

  if (state.kind === 'success') {
    return (
      <div
        role="status"
        style={{
          background: '#ecfdf5',
          border: '1px solid #a7f3d0',
          borderRadius: 10,
          padding: '20px 24px',
          marginBottom: 32,
          color: '#065f46',
        }}
      >
        <strong>Thanks — your SMS opt-in has been recorded.</strong>
        <p style={{ margin: '6px 0 0 0', fontSize: 14 }}>
          You can reply <strong>STOP</strong> at any time to unsubscribe.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        background: '#f9f9f9',
        borderRadius: 10,
        padding: '28px 32px',
        marginBottom: 32,
        border: '1px solid #e5e5e5',
      }}
    >
      <div style={{ marginBottom: 18 }}>
        <label htmlFor="first_name" style={labelStyle}>
          First Name <span style={{ color: '#c00' }}>*</span>
        </label>
        <input type="text" id="first_name" name="first_name" placeholder="Jane" required style={inputStyle} />
      </div>

      <div style={{ marginBottom: 18 }}>
        <label htmlFor="last_name" style={labelStyle}>
          Last Name <span style={{ color: '#c00' }}>*</span>
        </label>
        <input type="text" id="last_name" name="last_name" placeholder="Smith" required style={inputStyle} />
      </div>

      <div style={{ marginBottom: 18 }}>
        <label htmlFor="phone" style={labelStyle}>
          Mobile Phone Number <span style={{ color: '#c00' }}>*</span>
        </label>
        <input
          type="tel"
          id="phone"
          name="phone"
          placeholder="(801) 555-0100"
          required
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 24 }}>
        <label htmlFor="vehicle_interest" style={labelStyle}>
          Vehicle of Interest
        </label>
        <input
          type="text"
          id="vehicle_interest"
          name="vehicle_interest"
          placeholder="e.g. 2024 Toyota Camry"
          style={inputStyle}
        />
      </div>

      <div
        style={{
          background: '#fff',
          border: '1px solid #d0d0d0',
          borderRadius: 8,
          padding: '16px 18px',
          marginBottom: 20,
        }}
      >
        <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input
            type="checkbox"
            name="sms_consent"
            style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 13, color: '#333', lineHeight: 1.6 }}>
            {CONSENT_TEXT_SNAPSHOT}{' '}
            View our{' '}
            <a href="/privacy" style={{ color: '#0070f3' }}>
              Privacy Policy
            </a>{' '}
            and{' '}
            <a href="/sms-terms" style={{ color: '#0070f3' }}>
              SMS Terms
            </a>
            .
          </span>
        </label>
      </div>

      <button
        type="submit"
        disabled={state.kind === 'submitting'}
        style={{
          display: 'block',
          width: '100%',
          background: state.kind === 'submitting' ? '#7aa9e6' : '#0070f3',
          color: '#fff',
          border: 'none',
          borderRadius: 7,
          padding: '13px 0',
          fontSize: 16,
          fontWeight: 600,
          cursor: state.kind === 'submitting' ? 'not-allowed' : 'pointer',
          letterSpacing: '0.01em',
        }}
      >
        {state.kind === 'submitting' ? 'Submitting…' : 'Opt In to SMS Updates'}
      </button>

      {state.kind === 'error' && (
        <p role="alert" style={{ color: '#b91c1c', fontSize: 13, marginTop: 12, marginBottom: 0 }}>
          {state.message}
        </p>
      )}

      <p style={{ fontSize: 12, color: '#888', marginTop: 14, marginBottom: 0, textAlign: 'center' }}>
        Check the box above to consent to marketing SMS messages from BCHardy LLC. Msg &amp; data
        rates may apply. Reply STOP to unsubscribe at any time.
      </p>
    </form>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontWeight: 600,
  marginBottom: 6,
  fontSize: 14,
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '10px 12px',
  fontSize: 15,
  border: '1px solid #ccc',
  borderRadius: 6,
  boxSizing: 'border-box',
  background: '#fff',
  outline: 'none',
}
