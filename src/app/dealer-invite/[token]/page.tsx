/**
 * /dealer-invite/[token]
 *
 * Public page for dealers to claim their invite and create an account.
 * No auth required — the token is the credential.
 */

import { db } from '@/lib/db'
import { dealerInvites, tenants } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import Image from 'next/image'
import { DealerSignUpForm } from './DealerSignUpForm'

type Props = { params: { token: string } }

export default async function DealerInvitePage({ params }: Props) {
  const invite = await db.query.dealerInvites.findFirst({
    where: eq(dealerInvites.token, params.token),
  })

  // Invalid token
  if (!invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-sm px-6">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Invalid invite link</h1>
          <p className="text-sm text-gray-500">
            This link is invalid or has already been used. Ask your DLR contact to generate a new one.
          </p>
        </div>
      </div>
    )
  }

  // Expired
  if (new Date() > new Date(invite.expiresAt)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-sm px-6">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Invite expired</h1>
          <p className="text-sm text-gray-500">
            This invite expired on {new Date(invite.expiresAt).toLocaleDateString()}.
            Ask your DLR contact to generate a new one.
          </p>
        </div>
      </div>
    )
  }

  // Already used
  if (invite.used) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-sm px-6">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Invite already used</h1>
          <p className="text-sm text-gray-500">
            This invite link has already been redeemed.{' '}
            <a href="/login" className="text-blue-600 underline">Sign in instead</a>, or ask
            your DLR contact for a new invite if you need to create another account.
          </p>
        </div>
      </div>
    )
  }

  // Load tenant name
  const [tenantRow] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, invite.tenantId))

  const dealershipName = tenantRow?.name ?? 'your dealership'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Image
            src="/dlr-logo.svg"
            alt="DLR — Dead Lead Revival"
            width={160}
            height={48}
            priority
            style={{ width: 160, height: 'auto' }}
          />
        </div>

        {/* Card */}
        <div className="bg-white border border-gray-200 rounded-2xl px-8 py-8 shadow-sm">
          <h1 className="text-xl font-bold text-gray-900 mb-1">
            Set up your DLR account
          </h1>
          <p className="text-sm text-gray-500 mb-6">
            You&apos;ve been invited to manage Dead Lead Revival for{' '}
            <strong>{dealershipName}</strong>.
          </p>

          <DealerSignUpForm
            token={params.token}
            prefillEmail={invite.email ?? ''}
          />
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Already have an account?{' '}
          <a href="/login" className="text-blue-600 underline">Sign in</a>
        </p>
      </div>
    </div>
  )
}
