'use client'

import { useEffect } from 'react'
import { signOut } from 'next-auth/react'

// In-app signout interstitial.
//
// Reached only as a NextAuth signout fallback — NextAuth is configured
// to send any signout flow that would have rendered its bare default
// confirm form (manual GET to /api/auth/signout, browser back-button,
// stale bookmark) to this page instead. The component immediately calls
// signOut() to perform the actual JSON-POST signout, then redirects to
// /login. The body is just a brand-styled "signing you out" card so the
// dealer never sees the unstyled NextAuth form.
//
// The normal Log out button in the AccountMenu does NOT route through
// this page — it calls signOut() directly. This route is the safety net.
export default function LogoutPage() {
  useEffect(() => {
    void signOut({ callbackUrl: '/login' })
  }, [])

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center">
        <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-gray-100 flex items-center justify-center">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            className="animate-spin text-gray-500"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-gray-900 mb-1">Signing you out…</h1>
        <p className="text-sm text-gray-500">You&apos;ll be redirected to the sign-in page in a moment.</p>
      </div>
    </main>
  )
}
