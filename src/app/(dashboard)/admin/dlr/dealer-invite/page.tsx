/**
 * /admin/dlr/dealer-invite
 *
 * Admin page to generate a one-time dealer invite link for a tenant.
 *
 * Pre-fill via query string: tenantId, email, dealership. The Operator
 * Command Center on /admin/dlr/intakes/[id] links here with all three
 * already filled so the admin just clicks "Generate Invite Link" — no
 * UUID copy/paste from the database.
 *
 * After generation:
 *   - If SMTP is configured AND an email was provided, the invite is
 *     emailed and the UI shows "Invite emailed to X" + the link as a
 *     backup.
 *   - Otherwise the UI shows an honest "copy the link manually" state
 *     with the reason (no SMTP / no recipient / send failed) — no fake
 *     success.
 */

'use client'

import { Suspense, useEffect, useState, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  generateDealerInvite,
  type GenerateDealerInviteResult,
} from './actions'

export default function DealerInvitePage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading…</div>}>
      <DealerInviteClient />
    </Suspense>
  )
}

function DealerInviteClient() {
  const searchParams = useSearchParams()
  const initialTenant     = searchParams.get('tenantId')   ?? ''
  const initialEmail      = searchParams.get('email')      ?? ''
  const initialDealership = searchParams.get('dealership') ?? ''

  const [tenantId,       setTenantId]       = useState(initialTenant)
  const [email,          setEmail]          = useState(initialEmail)
  const [dealershipName, setDealershipName] = useState(initialDealership)
  const [result,         setResult]         = useState<GenerateDealerInviteResult | null>(null)
  const [isPending, startTransition]        = useTransition()
  const [error,          setError]          = useState<string | null>(null)
  const [copied,         setCopied]         = useState(false)

  // If the operator opens this page with different params (e.g. they
  // re-navigated from a different intake) keep the form in sync.
  useEffect(() => {
    setTenantId(initialTenant)
    setEmail(initialEmail)
    setDealershipName(initialDealership)
    setResult(null)
    setError(null)
  }, [initialTenant, initialEmail, initialDealership])

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)
    setCopied(false)

    if (!tenantId.trim()) {
      setError('Enter a tenant ID')
      return
    }

    startTransition(async () => {
      try {
        const r = await generateDealerInvite(tenantId.trim(), email.trim() || undefined)
        setResult(r)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to generate invite')
      }
    })
  }

  function copyLink() {
    if (!result) return
    navigator.clipboard.writeText(result.inviteUrl).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      () => {
        /* clipboard denied — fall back to the visible URL */
      },
    )
  }

  function reset() {
    setResult(null)
    setError(null)
    setCopied(false)
    // Keep the tenantId/email/dealership prefilled so the admin can
    // generate another invite quickly if needed (e.g. expired link).
  }

  return (
    <div className="p-4 sm:p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Invite dealer user</h1>
        <p className="mt-1 text-sm text-gray-500">
          Generate a one-time login link for a dealer. They&apos;ll create
          their own account in a single step — no passwords are shared.
          The link expires in 7 days.
        </p>
        {dealershipName && (
          <p className="mt-2 text-xs text-gray-500">
            Inviting a user for{' '}
            <strong className="font-semibold text-gray-700">{dealershipName}</strong>
          </p>
        )}
      </div>

      {!result && (
        <form
          onSubmit={handleGenerate}
          className="border border-gray-200 rounded-xl px-5 sm:px-6 py-5 space-y-4 bg-white"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tenant ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="UUID from the tenants table"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <p className="text-xs text-gray-400 mt-1">
              Pre-filled when you open this page from an intake&apos;s Operator
              Command Center.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Dealer email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@dealership.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              When provided, the invite is emailed to this address automatically.
              Otherwise you&apos;ll get a link to send manually.
            </p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={isPending}
            className="w-full sm:w-auto px-5 py-2.5 bg-gray-900 hover:bg-gray-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {isPending ? 'Generating…' : 'Generate invite link'}
          </button>
        </form>
      )}

      {result && (
        <InviteSuccess
          result={result}
          dealershipName={dealershipName}
          onReset={reset}
          onCopy={copyLink}
          copied={copied}
        />
      )}
    </div>
  )
}

// ── Success state ───────────────────────────────────────────────────────────

function InviteSuccess({
  result,
  dealershipName,
  onReset,
  onCopy,
  copied,
}: {
  result:         GenerateDealerInviteResult
  dealershipName: string
  onReset:        () => void
  onCopy:         () => void
  copied:         boolean
}) {
  const expiresLabel = new Date(result.expiresAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  // Pick the banner copy honestly based on what actually happened —
  // never claim "email sent" if SMTP was missing or the send failed.
  let banner: {
    tone:    'success' | 'info'
    title:   string
    detail:  string
  }
  if (result.emailResult.sent) {
    banner = {
      tone:   'success',
      title:  `Invite emailed to ${result.emailResult.recipient}`,
      detail: `They should receive it in a few minutes. The link below is the same one — keep it as a backup.`,
    }
  } else if (result.emailResult.reason === 'no_smtp') {
    banner = {
      tone:   'info',
      title:  'Email not configured on this environment',
      detail: 'Copy the link below and send it to the dealer manually.',
    }
  } else if (result.emailResult.reason === 'no_recipient') {
    banner = {
      tone:   'info',
      title:  'No dealer email provided',
      detail: 'Copy the link below and send it to the dealer manually.',
    }
  } else {
    banner = {
      tone:   'info',
      title:  'Could not deliver the email',
      detail: 'The invite link is still valid — copy it below and send it manually.',
    }
  }

  const bannerClass =
    banner.tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : 'border-amber-200 bg-amber-50 text-amber-900'
  const bannerIcon = banner.tone === 'success' ? '✓' : '⚠'

  return (
    <div className="border-2 border-gray-200 rounded-xl bg-white overflow-hidden">
      <div className={`border-b ${bannerClass} px-5 sm:px-6 py-4`}>
        <p className="text-sm font-semibold">
          <span className="mr-2">{bannerIcon}</span>
          {banner.title}
        </p>
        <p className="text-xs mt-1 opacity-90">{banner.detail}</p>
      </div>

      <div className="px-5 sm:px-6 py-5 space-y-4">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
            Invite link
            {dealershipName ? ` for ${dealershipName}` : ''}
          </p>
          <div className="flex flex-col sm:flex-row sm:items-stretch gap-2">
            <code className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-gray-800 break-all">
              {result.inviteUrl}
            </code>
            <button
              type="button"
              onClick={onCopy}
              className="flex-shrink-0 px-3 py-2 bg-gray-900 hover:bg-gray-700 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              {copied ? 'Copied' : 'Copy invite link'}
            </button>
          </div>
        </div>

        <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-xs text-gray-600 space-y-1">
          <p>
            <span className="font-semibold text-gray-800">Single-use.</span>{' '}
            Once redeemed, the link cannot be used again.
          </p>
          <p>
            <span className="font-semibold text-gray-800">Expires:</span>{' '}
            {expiresLabel}
          </p>
          <p>
            <span className="font-semibold text-gray-800">After login:</span>{' '}
            The dealer is taken to their dashboard to upload leads and
            review previews. No campaigns send without their approval.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-gray-500 underline hover:text-gray-700 self-start"
          >
            Generate another invite
          </button>
        </div>
      </div>
    </div>
  )
}
