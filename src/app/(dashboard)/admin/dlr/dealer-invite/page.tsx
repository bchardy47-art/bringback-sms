/**
 * /admin/dlr/dealer-invite
 *
 * Admin page to generate a one-time dealer invite link.
 * Select a tenant → generates a token → displays the full URL for the admin to send.
 */

'use client'

import { useState, useTransition } from 'react'
import { generateDealerInvite } from './actions'

// We import tenants server-side via a separate RSC wrapper below.
// The client component receives them as props.

export default function DealerInvitePage() {
  return <DealerInviteClient />
}

// ── Client component ──────────────────────────────────────────────────────────

function DealerInviteClient() {
  const [tenantId, setTenantId] = useState('')
  const [email, setEmail]       = useState('')
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [error, setError]       = useState<string | null>(null)

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInviteUrl(null)

    if (!tenantId) {
      setError('Enter a tenant ID')
      return
    }

    startTransition(async () => {
      try {
        const result = await generateDealerInvite(tenantId.trim(), email.trim() || undefined)
        const base   = window.location.origin
        setInviteUrl(`${base}/dealer-invite/${result.token}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to generate invite')
      }
    })
  }

  function copyToClipboard() {
    if (inviteUrl) {
      navigator.clipboard.writeText(inviteUrl).catch(() => {})
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Generate Dealer Invite</h1>
        <p className="mt-1 text-sm text-gray-500">
          Create a one-time link for a dealer to set up their DLR account. The link expires in 7 days.
        </p>
      </div>

      <form onSubmit={handleGenerate} className="border border-gray-200 rounded-xl px-6 py-5 space-y-4 bg-white">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Tenant ID <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={tenantId}
            onChange={e => setTenantId(e.target.value)}
            placeholder="UUID from the tenants table"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <p className="text-xs text-gray-400 mt-1">
            Find this in the intakes detail page or database.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Dealer email (optional)
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Pre-fill the sign-up form"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2.5 bg-gray-900 hover:bg-gray-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
        >
          {isPending ? 'Generating…' : 'Generate Invite Link'}
        </button>
      </form>

      {inviteUrl && (
        <div className="border-2 border-emerald-200 rounded-xl px-6 py-5 bg-emerald-50 space-y-3">
          <p className="text-sm font-semibold text-emerald-900">✓ Invite link generated</p>
          <p className="text-xs text-emerald-700">
            Send this link to the dealer. It is single-use and expires in 7 days.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border border-emerald-200 rounded-lg px-3 py-2 text-xs font-mono text-gray-800 break-all">
              {inviteUrl}
            </code>
            <button
              onClick={copyToClipboard}
              className="flex-shrink-0 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              Copy
            </button>
          </div>
          <button
            onClick={() => { setInviteUrl(null); setTenantId(''); setEmail('') }}
            className="text-xs text-gray-400 underline"
          >
            Generate another
          </button>
        </div>
      )}
    </div>
  )
}
