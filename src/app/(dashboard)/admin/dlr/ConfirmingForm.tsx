'use client'

/**
 * Wraps a `<form>` with a `window.confirm()` gate.
 *
 * Use for destructive or scope-significant admin actions (pause / resume
 * tenant automation, live-SMS pilot starts, etc.) so a misclick can't
 * fire the underlying action without a second tap. Smallest possible
 * safety addition: no modal, no extra state, no new dependencies —
 * just intercept submit and require an OK from the native browser
 * confirm dialog.
 *
 * Accepts either a Next.js server-action reference (typed function) OR
 * a plain string action URL with `method="POST"` for HTTP form posts to
 * API routes. The same wrapper covers both call sites in admin.
 *
 * Usage (server action):
 *   <ConfirmingForm action={pause} confirmMessage="…">
 *     <button type="submit">Pause automation</button>
 *   </ConfirmingForm>
 *
 * Usage (HTTP POST to API route):
 *   <ConfirmingForm
 *     action="/api/admin/live-pilot/abc"
 *     method="POST"
 *     confirmMessage="…"
 *   >
 *     <input type="hidden" name="action" value="start_smoke" />
 *     <button type="submit">Send live SMS smoke test →</button>
 *   </ConfirmingForm>
 */

import type { ReactNode } from 'react'

type ServerAction = (formData: FormData) => void | Promise<void>

export function ConfirmingForm({
  action,
  method,
  confirmMessage,
  children,
  className,
}: {
  action:         string | ServerAction
  method?:        'GET' | 'POST'
  confirmMessage: string
  children:       ReactNode
  className?:     string
}) {
  return (
    <form
      action={action}
      method={method}
      onSubmit={(e) => {
        if (typeof window === 'undefined') return
        const ok = window.confirm(confirmMessage)
        if (!ok) {
          e.preventDefault()
        }
      }}
      className={className}
    >
      {children}
    </form>
  )
}
