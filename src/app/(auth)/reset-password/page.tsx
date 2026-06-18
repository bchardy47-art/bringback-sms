'use client'

import { useState, FormEvent, Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { resetPassword } from '../forgot-password/actions'

// Wrapped in Suspense because useSearchParams() requires it in Next.js App Router.
function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password,        setPassword]        = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting,      setSubmitting]      = useState(false)
  const [success,         setSuccess]         = useState(false)
  const [error,           setError]           = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const result = await resetPassword(token, password, confirmPassword)

    if (result.ok) {
      setSuccess(true)
    } else {
      setError(result.error)
    }

    setSubmitting(false)
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="text-center py-2">
        <div className="mb-4 flex justify-center">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full text-2xl"
            style={{ background: 'rgba(220,38,38,0.08)' }}
          >
            ✓
          </span>
        </div>
        <p className="text-sm font-medium text-gray-900 mb-1">Password updated</p>
        <p className="text-sm text-gray-500 leading-relaxed mb-6">
          Your password has been reset successfully. You can now sign in with
          your new password.
        </p>
        <Link
          href="/login"
          className="inline-block rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-gray-700 transition-colors"
        >
          Sign in
        </Link>
      </div>
    )
  }

  // ── Invalid / missing token state ──────────────────────────────────────────
  if (!token) {
    return (
      <div className="text-center py-2">
        <p className="text-sm font-medium text-gray-900 mb-1">Invalid reset link</p>
        <p className="text-sm text-gray-500 leading-relaxed mb-6">
          This link is missing the reset token. Please request a new one.
        </p>
        <Link
          href="/forgot-password"
          className="text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors"
        >
          Request a new link
        </Link>
      </div>
    )
  }

  // ── Password form ──────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-1.5">
          New password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="block w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm transition-colors focus:border-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-300"
          placeholder="At least 8 characters"
        />
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-semibold text-gray-700 mb-1.5">
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="block w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm transition-colors focus:border-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-300"
          placeholder="Repeat password"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 px-3.5 py-2.5">
          <span className="text-red-400 text-sm mt-px select-none">⚠</span>
          <p className="text-sm text-red-600 leading-snug" role="alert">
            {error}{' '}
            {error.includes('invalid or has expired') && (
              <Link href="/forgot-password" className="underline font-medium">
                Request a new link.
              </Link>
            )}
          </p>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-1 w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:bg-gray-700 active:bg-gray-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Updating…' : 'Set new password'}
      </button>

      <div className="pt-1 text-center">
        <Link
          href="/login"
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← Back to sign in
        </Link>
      </div>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 py-12"
      style={{
        background:
          'radial-gradient(ellipse 130% 55% at 50% -8%, rgba(220,38,38,0.09) 0%, transparent 70%),' +
          'linear-gradient(180deg, #f4f4f5 0%, #e9e9eb 100%)',
      }}
    >
      <div className="w-full max-w-md">

        {/* ── Logo ────────────────────────────────────────────────────────── */}
        <div className="mb-6 text-center">
          <div className="flex justify-center mb-5">
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                width: 'clamp(180px, 28vw, 260px)',
                boxShadow:
                  '0 1px 0 rgba(255,255,255,0.08) inset,' +
                  '0 22px 56px -14px rgba(220,38,38,0.42),' +
                  '0 4px 14px -4px rgba(0,0,0,0.22)',
              }}
            >
              <Image
                src="/brand/dlr-logo.png"
                alt="Dead Lead Revival"
                width={320}
                height={107}
                priority
                style={{ width: '100%', height: 'auto', display: 'block' }}
              />
            </div>
          </div>

          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500 mb-2">
            Dealer Revival Portal
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
            Choose a new password
          </h1>
          <p className="mt-2 text-sm text-gray-500 leading-relaxed">
            Pick something strong — at least 8 characters.
          </p>
        </div>

        {/* ── Card ────────────────────────────────────────────────────────── */}
        <div
          className="rounded-2xl bg-white px-8 py-8"
          style={{
            boxShadow:
              '0 0 0 1px rgba(0,0,0,0.06),' +
              '0 6px 12px -4px rgba(0,0,0,0.07),' +
              '0 24px 60px -10px rgba(0,0,0,0.20)',
          }}
        >
          <Suspense fallback={<p className="text-sm text-gray-500 text-center py-4">Loading…</p>}>
            <ResetPasswordForm />
          </Suspense>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <p className="mt-6 text-center text-xs text-gray-400 tracking-wide">
          Secure dealer access · Managed by DLR
        </p>

      </div>
    </div>
  )
}
