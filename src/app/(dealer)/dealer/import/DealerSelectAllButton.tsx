'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function DealerSelectAllButton({
  tenantId,
  apiBase = '/api/dealer/pilot-leads',
  eligibleCount,
  selectedCount = 0,
  cap,
}: {
  tenantId: string
  apiBase?: string
  /** Total leads currently in the `eligible` or `warning` bucket (selectable). */
  eligibleCount: number
  /** Number already selected — used to compute remaining headroom under the cap. */
  selectedCount?: number
  /**
   * Hard cap for the first pilot (FIRST_PILOT_CAP). When provided, the button
   * announces how many it can add and how the cap will apply.
   */
  cap?: number
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // How many more leads we can actually add given the cap. If no cap is
  // supplied, fall back to the raw eligible count.
  const headroom = cap != null
    ? Math.max(0, cap - selectedCount)
    : eligibleCount
  const willAdd = Math.min(eligibleCount, headroom)
  const capWillTrim = cap != null && eligibleCount > headroom

  async function handleSelectAll() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/select-all-eligible`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (data.ok) {
        router.refresh()
      } else {
        setError(data.error ?? 'Could not select leads — please try again.')
        setLoading(false)
      }
    } catch {
      setError('Network error — please try again.')
      setLoading(false)
    }
  }

  // Compose the headline and the supporting copy. When the cap will trim the
  // selection, we say so up front so the dealer is not surprised when the
  // counter lands below their eligibility count.
  const headline = selectedCount > 0
    ? `${willAdd} more lead${willAdd === 1 ? '' : 's'} can join your campaign selection`
    : `${eligibleCount} lead${eligibleCount === 1 ? '' : 's'} ready for your campaign`

  const buttonLabel = loading
    ? 'Selecting…'
    : selectedCount > 0
    ? `Add ${willAdd} more →`
    : 'Select all eligible →'

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-black text-white">{headline}</p>
        <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
          {capWillTrim ? (
            <>
              The first pilot is capped at {cap} leads, so we&apos;ll add the {willAdd}{' '}
              earliest eligible {willAdd === 1 ? 'lead' : 'leads'} for your review.
              Add them, then review and confirm in Step&nbsp;3.
            </>
          ) : (
            <>
              Add {selectedCount > 0 ? 'the rest' : 'them all'} to your campaign selection,
              then review and confirm in Step&nbsp;3.
            </>
          )}
        </p>
        {error && (
          <p className="text-xs mt-1 text-red-400">{error}</p>
        )}
      </div>
      <button
        onClick={handleSelectAll}
        disabled={loading || willAdd === 0}
        className="shrink-0 px-4 py-2 text-sm font-bold text-white rounded-lg transition-colors disabled:opacity-50"
        style={{
          background: loading || willAdd === 0 ? 'rgba(255,255,255,0.1)' : 'linear-gradient(180deg, #ff2929, #8b0909)',
          border: '1px solid rgba(255,80,80,0.7)',
          boxShadow: loading || willAdd === 0 ? 'none' : '0 0 12px rgba(255,27,27,0.45)',
        }}
      >
        {buttonLabel}
      </button>
    </div>
  )
}
