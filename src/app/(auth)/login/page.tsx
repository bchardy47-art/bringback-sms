'use client'

import { useState, FormEvent, Suspense } from 'react'
import Image from 'next/image'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'

function InviteBanner() {
  const searchParams = useSearchParams()
  if (searchParams.get('invited') !== '1') return null
  return (
    <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 text-center">
      ✓ Account created! Sign in with your new credentials.
    </div>
  )
}

// Only same-origin relative paths are honored as post-login destinations.
// Rejects protocol-relative URLs ("//evil.com"), absolute URLs, and anything
// that isn't a path under this app — guards against open redirect.
function safeCallbackUrl(raw: string | null): string | null {
  if (!raw) return null
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//')) return null
  return raw
}

// A callbackUrl is only honored if the post-login shell will actually accept
// the user's role. Otherwise the middleware would just bounce them back to
// their own shell, producing a visible flash. Pick the right home up front.
function destinationForRole(role: string, callback: string | null): string {
  const dealerHome = '/dealer/dashboard'
  const teamHome = '/dashboard'
  if (role === 'dealer') {
    if (callback && callback.startsWith('/dealer/')) return callback
    return dealerHome
  }
  // admin / manager / agent → team shell
  if (callback && !callback.startsWith('/dealer/')) return callback
  return teamHome
}

export default function LoginPage() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const res = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })

    if (res?.error) {
      setError('Invalid email or password.')
      setSubmitting(false)
    } else {
      const params = new URLSearchParams(window.location.search)
      const callbackUrl = safeCallbackUrl(params.get('callbackUrl'))

      // Read the freshly-issued session to learn the role, then send the
      // user straight to the shell that matches them. Avoids the
      // /dashboard → middleware → /dealer/dashboard flash for dealers.
      let role = ''
      try {
        const sessionRes = await fetch('/api/auth/session', { cache: 'no-store' })
        if (sessionRes.ok) {
          const data = await sessionRes.json()
          role = data?.user?.role ?? ''
        }
      } catch {
        // fall through — destinationForRole defaults to /dashboard
      }
      router.replace(destinationForRole(role, callbackUrl))
    }
  }

  return (
    /*
     * Premium login shell — visual redesign only.
     * Auth logic (signIn, safeCallbackUrl, destinationForRole) is untouched.
     *
     * Layout layers:
     *   1. Full-screen gradient background with a very faint red halo at top
     *   2. Content column (max-w-md) — logo header + elevated card + footer
     *   3. Card — white, strong layered shadow, rounded-2xl
     */
    <div
      className="flex min-h-screen items-center justify-center px-4 py-12"
      style={{
        background:
          'radial-gradient(ellipse 130% 55% at 50% -8%, rgba(220,38,38,0.09) 0%, transparent 70%),' +
          'linear-gradient(180deg, #f4f4f5 0%, #e9e9eb 100%)',
      }}
    >
      <div className="w-full max-w-md">

        {/* ── Logo + header copy ───────────────────────────────────────── */}
        <div className="mb-6 text-center">
          <div className="flex justify-center mb-5">
            {/* DLR logo — dark-bg PNG clipped to rounded card.
                Wrapper div drives responsive width via clamp(); Image fills it.
                Ceiling raised from 252px → 320px (~27% larger on desktop) to
                anchor the page more confidently. clamp() keeps it responsive. */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                width: 'clamp(220px, 32vw, 320px)',
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
            Sign in to your Revival Center
          </h1>
          <p className="mt-2 text-sm text-gray-500 leading-relaxed">
            Access your dealership&apos;s lead revival campaigns,
            approvals, and conversations.
          </p>
        </div>

        {/* ── Invite banner (query-param driven, usually hidden) ────────── */}
        <Suspense>
          <InviteBanner />
        </Suspense>

        {/* ── Login card ──────────────────────────────────────────────── */}
        <div
          className="rounded-2xl bg-white px-8 py-8"
          style={{
            boxShadow:
              '0 0 0 1px rgba(0,0,0,0.06),' +
              '0 6px 12px -4px rgba(0,0,0,0.07),' +
              '0 24px 60px -10px rgba(0,0,0,0.20)',
          }}
        >
          <form onSubmit={handleSubmit} className="space-y-5">

            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm transition-colors focus:border-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-300"
                placeholder="you@dealership.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm transition-colors focus:border-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-300"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 px-3.5 py-2.5">
                <span className="text-red-400 text-sm mt-px select-none">⚠</span>
                <p className="text-sm text-red-600 leading-snug" role="alert">
                  {error}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:bg-gray-700 active:bg-gray-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>

          </form>
        </div>

        {/* ── Microcopy footer ─────────────────────────────────────────── */}
        <p className="mt-6 text-center text-xs text-gray-400 tracking-wide">
          Secure dealer access · Managed by DLR
        </p>

      </div>
    </div>
  )
}
