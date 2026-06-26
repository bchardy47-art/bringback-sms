'use client'

/**
 * Live controls for /admin/activity — turns the static log into a lightweight
 * monitor without any new data plumbing.
 *
 *  - Auto-refreshes the server component every 30s (never faster).
 *  - Shows a "Last updated" stamp (driven by the server's render time).
 *  - Provides a manual "Refresh activity" button.
 *
 * Refresh works by re-navigating (router.replace) to the same URL with a
 * cache-busting `_t` param, so the existing filter params (type / tenant / q)
 * in the URL are preserved verbatim. The server reads `_t` only to skip its
 * page-view tracking on these background refreshes — it does not change what
 * is tracked for real navigations, nor any query/data logic.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// Automatic poll cadence — the page never re-queries the DB on a timer faster
// than this. The manual button has only a small anti-double-click debounce.
const REFRESH_MS = 30_000
const MIN_GAP_MS = 2_000

export function ActivityLiveControls({ renderedAt }: { renderedAt: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [updatedLabel, setUpdatedLabel] = useState('')
  const lastRefreshRef = useRef(0)

  // Re-fetch by navigating to the current URL + a fresh `_t`, keeping all
  // existing filter params. Debounced against rapid double-clicks; the
  // background cadence is enforced separately by the 30s interval.
  const refresh = useCallback(() => {
    if (typeof window === 'undefined') return
    const now = Date.now()
    if (now - lastRefreshRef.current < MIN_GAP_MS) return
    lastRefreshRef.current = now
    const params = new URLSearchParams(window.location.search)
    params.set('_t', String(now))
    setPending(true)
    router.replace(`/admin/activity?${params.toString()}`, { scroll: false })
  }, [router])

  // Fixed 30s automatic cadence.
  useEffect(() => {
    const id = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh])

  // A change in the server-provided render time means a refresh landed.
  useEffect(() => {
    setPending(false)
    setUpdatedLabel(new Date(renderedAt).toLocaleTimeString())
  }, [renderedAt])

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-400" suppressHydrationWarning>
        Last updated {updatedLabel || '…'}
      </span>
      <button
        type="button"
        onClick={refresh}
        disabled={pending}
        className="text-sm font-semibold rounded-lg px-3 py-1.5 border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? 'Refreshing…' : 'Refresh activity'}
      </button>
    </div>
  )
}
