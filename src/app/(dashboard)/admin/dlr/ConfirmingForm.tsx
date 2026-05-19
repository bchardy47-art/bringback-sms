'use client'

/**
 * Wraps a server-action `<form>` with a `window.confirm()` gate.
 *
 * Use for destructive or scope-significant admin actions (pause / resume
 * tenant automation, etc.) so a misclick can't fire the underlying
 * server action without a second tap. Smallest possible safety addition:
 * no modal, no extra state, no new dependencies — just intercept submit
 * and require an OK from the native browser confirm dialog.
 *
 * Server-action references can be passed across the server→client
 * boundary in Next.js 14, so the parent server component still owns the
 * action body; this wrapper only owns the click-time confirmation.
 *
 * Usage:
 *   <ConfirmingForm
 *     action={pause}
 *     confirmMessage="This will pause automation for Acme Honda…"
 *   >
 *     <button type="submit">Pause automation</button>
 *   </ConfirmingForm>
 */

import type { ReactNode } from 'react'

type ServerAction = (formData: FormData) => void | Promise<void>

export function ConfirmingForm({
  action,
  confirmMessage,
  children,
  className,
}: {
  action:         ServerAction
  confirmMessage: string
  children:       ReactNode
  className?:     string
}) {
  return (
    <form
      action={action}
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
