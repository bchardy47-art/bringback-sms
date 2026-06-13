'use client'

/**
 * Dealer-side lead-source attestation gate.
 * UI-only: no DB writes, no API calls. Resets on full page reload intentionally.
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
        className="flex items-start gap-3 px-4 py-3.5 rounded-xl cursor-pointer transition-colors"
        style={confirmed ? {
          background: 'rgba(34,197,94,0.1)',
          border: '1px solid rgba(34,197,94,0.4)',
        } : {
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.38)',
        }}
      >
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded accent-emerald-500"
        />
        <span className="text-sm leading-relaxed">
          <span className="font-semibold" style={{ color: confirmed ? '#86efac' : '#fde68a' }}>
            I confirm these leads are from our dealership/customer records and are
            covered by our approved SMS campaign.
          </span>{' '}
          <span style={{ color: 'rgba(255,255,255,0.6)' }}>
            Leads with unknown or revoked consent cannot be selected for campaign
            messaging.
          </span>
        </span>
      </label>

      <div
        className={confirmed ? '' : 'opacity-40 pointer-events-none select-none'}
        aria-disabled={!confirmed}
      >
        {children}
      </div>

      {!confirmed && (
        <p className="text-xs italic" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Tick the attestation above to enable CSV upload.
        </p>
      )}
    </div>
  )
}
