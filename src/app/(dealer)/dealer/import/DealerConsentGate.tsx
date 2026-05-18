'use client'

/**
 * Dealer-side consent attestation gate for the Upload Dead Leads page.
 *
 * The dealer must affirm that the leads they're about to upload are from
 * their dealership/customer records and covered by the dealership's
 * approved SMS campaign before the upload UI is interactive.
 *
 * UI-only:
 *   - No server state. No DB writes. No API calls.
 *   - State resets on full page reload, so each session is a fresh
 *     attestation — that's intentional. Don't persist in localStorage.
 *   - Does NOT change consent classification on individual leads, which
 *     is computed downstream in the import pipeline from the CSV columns.
 *   - The visible upload form is still mounted while disabled so screen
 *     readers see it; we just block interaction until the box is ticked.
 */

import { useState } from 'react'

type Props = {
  children: React.ReactNode
}

export function DealerConsentGate({ children }: Props) {
  const [confirmed, setConfirmed] = useState(false)

  return (
    <div className="space-y-4">
      <label
        className={`flex items-start gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors ${
          confirmed
            ? 'border-emerald-200 bg-emerald-50'
            : 'border-amber-300 bg-amber-50'
        }`}
      >
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
        />
        <span className="text-sm leading-relaxed text-gray-800">
          <span className="font-semibold">
            I confirm these leads are from our dealership/customer records and are
            covered by our approved SMS campaign.
          </span>{' '}
          <span className="text-gray-600">
            Leads with unknown or revoked consent cannot be selected for pilot
            messaging.
          </span>
        </span>
      </label>

      <div
        className={confirmed ? '' : 'opacity-50 pointer-events-none select-none'}
        aria-disabled={!confirmed}
      >
        {children}
      </div>

      {!confirmed && (
        <p className="text-xs text-gray-500 italic">
          Tick the attestation above to enable CSV upload.
        </p>
      )}
    </div>
  )
}
