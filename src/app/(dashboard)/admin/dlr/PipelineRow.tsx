'use client'

/**
 * Clickable <tr> for the Dealer Setup Pipeline table on /admin/dlr.
 *
 * Wraps a single table row so the entire row is a navigation target — not
 * just a small "Open →" link at the right edge. Keeps table semantics
 * (valid <tr>/<td> structure) instead of using an <a> wrapper, which the
 * HTML parser would hoist out of the <tbody> and break the layout.
 *
 * Behaviour:
 *   - click anywhere in the row → router.push(href)
 *   - Enter / Space when focused → same
 *   - tabIndex=0 + role="link" → keyboard + screen-reader reachable
 *   - opacity bump while the navigation transition is pending so the click
 *     feels responsive even on the cold-cache first hop
 *
 * Does NOT change any data flow, query, or auth — `href` is already
 * computed in src/lib/admin/platform-queries.ts (PipelineRow.nextActionHref).
 */

import { useRouter } from 'next/navigation'
import { useTransition, type KeyboardEvent, type ReactNode } from 'react'

type Props = {
  href:     string
  children: ReactNode
}

export function PipelineRow({ href, children }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function go() {
    startTransition(() => router.push(href))
  }

  function onKey(e: KeyboardEvent<HTMLTableRowElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      go()
    }
  }

  return (
    <tr
      role="link"
      tabIndex={0}
      aria-label={`Open ${href}`}
      onClick={go}
      onKeyDown={onKey}
      className={`cursor-pointer hover:bg-gray-50 transition-colors focus:outline-none focus:bg-gray-50 ${
        isPending ? 'opacity-60' : ''
      }`}
    >
      {children}
    </tr>
  )
}
