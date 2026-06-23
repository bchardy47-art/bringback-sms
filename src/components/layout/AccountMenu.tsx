'use client'

import { useEffect, useRef, useState } from 'react'
import { signOut } from 'next-auth/react'
import Link from 'next/link'
import { LogOut, Settings as SettingsIcon } from 'lucide-react'

type Props = {
  name: string
  email: string
  initials: string
  /** When set, render a "Settings" menu item linking to this path. */
  settingsHref?: string
}

export function AccountMenu({ name, email, initials, settingsHref }: Props) {
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Fixed-position coordinates for the dropdown. The sidebar that hosts this
  // menu uses `overflow-y: auto`, which clips any absolutely-positioned child —
  // so an `absolute` dropdown opens but is invisible ("chevron does nothing").
  // Rendering it `fixed`, anchored to the trigger's viewport rect, escapes the
  // clip entirely.
  const [coords, setCoords] = useState<{ left: number; bottom: number } | null>(null)
  const MENU_WIDTH = 256

  function toggle() {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      const left = Math.max(12, Math.min(r.left, window.innerWidth - MENU_WIDTH - 12))
      setCoords({ left, bottom: window.innerHeight - r.top + 8 })
    }
    setOpen((v) => !v)
  }

  // Close on outside click / Escape / scroll / resize (fixed coords would drift)
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onReflow() {
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onReflow, true)
    window.addEventListener('resize', onReflow)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onReflow, true)
      window.removeEventListener('resize', onReflow)
    }
  }, [open])

  async function handleSignOut() {
    setSigningOut(true)
    await signOut({ callbackUrl: '/login' })
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-gray-100"
      >
        <div className="relative">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold"
            style={{ backgroundColor: '#1f2937' }}
          >
            {initials}
          </div>
          <span
            className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white"
            style={{ backgroundColor: '#22c55e' }}
          />
        </div>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="M3 4.5L6 7.5L9 4.5"
            stroke="#9ca3af"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && coords && (
        <div
          role="menu"
          className="fixed rounded-xl bg-white shadow-lg z-50 overflow-hidden"
          style={{
            border: '1px solid #e5e7eb',
            left: coords.left,
            bottom: coords.bottom,
            width: MENU_WIDTH,
          }}
        >
          <div className="px-4 py-3" style={{ borderBottom: '1px solid #f3f4f6' }}>
            <p className="text-sm font-semibold text-gray-900 truncate">{name}</p>
            <p className="text-xs text-gray-500 truncate mt-0.5">{email}</p>
          </div>

          <div className="py-1">
            {settingsHref && (
              <Link
                href={settingsHref}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <SettingsIcon size={15} className="text-gray-400" />
                Settings
              </Link>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              disabled={signingOut}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LogOut size={15} className="text-gray-400" />
              {signingOut ? 'Signing out…' : 'Log out'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
