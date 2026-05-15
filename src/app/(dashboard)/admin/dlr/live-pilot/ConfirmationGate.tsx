'use client'

/**
 * Phase 13 — Confirmation Gate (client component)
 *
 * The admin must:
 *   1. Type "SEND FIRST PILOT" exactly
 *   2. Check all four compliance checkboxes
 *   3. Click Confirm
 *
 * Submits to POST /api/admin/live-pilot/[batchId] { action: 'confirm' }
 */

import { useState } from 'react'
import { REQUIRED_CONFIRMATION_PHRASE } from '@/lib/db/schema'
import type { PilotConfirmationChecks } from '@/lib/db/schema'

type Props = {
  batchId: string
}

const CHECKBOXES: { key: keyof PilotConfirmationChecks; label: string }[] = [
  {
    key: 'tenDlcApproved',
    label: 'I confirm that 10DLC / Telnyx brand and campaign registration is approved (or dev_override is intentionally set)',
  },
  {
    key: 'messageReviewed',
    label: 'I confirm that I have reviewed all message bodies, including the opt-out footer, and they are accurate',
  },
  {
    key: 'optOutTested',
    label: 'I confirm that the STOP opt-out path has been tested and works correctly',
  },
  {
    key: 'emergencyControlsUnderstood',
    label: 'I confirm that I understand the emergency pause and cancel controls and know how to use them',
  },
]

export function ConfirmationGate({ batchId }: Props) {
  const [phrase, setPhrase] = useState('')
  const [checks, setChecks] = useState<PilotConfirmationChecks>({
    tenDlcApproved:               false,
    messageReviewed:              false,
    optOutTested:                 false,
    emergencyControlsUnderstood:  false,
  })
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors]         = useState<string[]>([])
  const [success, setSuccess]       = useState(false)

  const phraseOk    = phrase.trim() === REQUIRED_CONFIRMATION_PHRASE
  const allChecked  = Object.values(checks).every(Boolean)
  const canSubmit   = phraseOk && allChecked && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setErrors([])

    try {
      const res = await fetch(`/api/admin/live-pilot/${batchId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', phrase, checks }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }

      if (!res.ok || !data.ok) {
        setErrors([data.error ?? 'Unknown error'])
        return
      }
      setSuccess(true)
      // Full reload so the server-component tree re-renders with the
      // newly-unlocked smoke-test gate. Previously the parent server
      // component tried to pass an inline () => window.location.reload()
      // as an `onConfirmed` prop, which Next.js cannot serialize across
      // the RSC boundary (event handlers can't be passed from server
      // components to client components). Calling reload here keeps the
      // hard-refresh behaviour and removes the prop entirely.
      window.location.reload()
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Network error'])
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4">
        <p className="font-semibold text-emerald-800 text-sm">✓ Confirmation submitted</p>
        <p className="text-xs text-emerald-700 mt-1">The smoke test is now unlocked. Proceed to start it.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Warning */}
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
        <p className="text-sm font-semibold text-red-800">⚠ Final confirmation before live SMS sends</p>
        <p className="text-xs text-red-700 mt-1">
          This will authorize real text messages to real phone numbers. Once sent, messages cannot be recalled.
          Complete every item below before proceeding.
        </p>
      </div>

      {/* Checkboxes */}
      <div className="space-y-3">
        {CHECKBOXES.map(({ key, label }) => (
          <label key={key} className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={checks[key]}
              onChange={e => setChecks(prev => ({ ...prev, [key]: e.target.checked }))}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 flex-shrink-0"
            />
            <span className={`text-sm ${checks[key] ? 'text-gray-800' : 'text-gray-600'}`}>
              {label}
            </span>
          </label>
        ))}
      </div>

      {/* Phrase input */}
      <div className="space-y-1.5">
        <label className="block text-sm font-semibold text-gray-800">
          Type <span className="font-mono text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">{REQUIRED_CONFIRMATION_PHRASE}</span> to confirm
        </label>
        <input
          type="text"
          value={phrase}
          onChange={e => setPhrase(e.target.value)}
          placeholder={REQUIRED_CONFIRMATION_PHRASE}
          className={`w-full px-3 py-2 border rounded-lg text-sm font-mono ${
            phrase.length > 0
              ? phraseOk
                ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                : 'border-red-400 bg-red-50 text-red-800'
              : 'border-gray-300 bg-white text-gray-900'
          }`}
          autoComplete="off"
          spellCheck={false}
        />
        {phrase.length > 0 && !phraseOk && (
          <p className="text-xs text-red-600">Must match exactly: {REQUIRED_CONFIRMATION_PHRASE}</p>
        )}
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 space-y-1">
          {errors.map((e, i) => (
            <p key={i} className="text-xs text-red-700">• {e}</p>
          ))}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={!canSubmit}
        className={`w-full py-3 rounded-lg text-sm font-bold transition-colors ${
          canSubmit
            ? 'bg-red-600 hover:bg-red-700 text-white'
            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
        }`}
      >
        {submitting ? 'Confirming…' : 'Confirm & Unlock Smoke Test'}
      </button>

      {!canSubmit && (
        <p className="text-xs text-gray-400 text-center">
          {!allChecked ? 'Check all boxes above' : 'Type the confirmation phrase exactly'}
        </p>
      )}
    </form>
  )
}
