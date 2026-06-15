'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function DealerSelectAllButton({
  tenantId,
  apiBase = '/api/dealer/pilot-leads',
  eligibleCount,
}: {
  tenantId: string
  apiBase?: string
  eligibleCount: number
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

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

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-black text-white">
          {eligibleCount} lead{eligibleCount !== 1 ? 's' : ''} ready for your campaign
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Add them all to your campaign selection, then review and confirm in Step 3.
        </p>
        {error && (
          <p className="text-xs mt-1 text-red-400">{error}</p>
        )}
      </div>
      <button
        onClick={handleSelectAll}
        disabled={loading}
        className="shrink-0 px-4 py-2 text-sm font-bold text-white rounded-lg transition-colors disabled:opacity-50"
        style={{
          background: loading ? 'rgba(255,255,255,0.1)' : 'linear-gradient(180deg, #ff2929, #8b0909)',
          border: '1px solid rgba(255,80,80,0.7)',
          boxShadow: loading ? 'none' : '0 0 12px rgba(255,27,27,0.45)',
        }}
      >
        {loading ? 'Selecting…' : 'Select all eligible →'}
      </button>
    </div>
  )
}
