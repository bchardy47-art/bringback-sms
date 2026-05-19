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
        <div className="bg-white border border-gray-200 rounded-2xl px-6 sm:px-8 py-8 shadow-sm">
          <h1 className="text-xl font-bold text-gray-900 mb-1">
            Set up your DLR account
          </h1>
          <p className="text-sm text-gray-500 mb-5">
            You&apos;ve been invited to manage Dead Lead Revival for{' '}
            <strong>{dealershipName}</strong>.
          </p>

          {/* What dealers are signing into — answers "what is DLR?" and
              "what happens after I create this login?" so the page
              doesn't feel like a generic password form. */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 mb-6 space-y-2.5">
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
              About DLR
            </p>
            <p className="text-xs text-gray-600 leading-relaxed">
              DLR (Dead Lead Revival) is a managed SMS service that helps
              your dealership re-engage cold and stale leads — only after
              your campaign is approved by the carriers and reviewed by you.
            </p>
            <div>
              <p className="text-xs font-semibold text-gray-700 mt-1 mb-1">
                After you log in you&apos;ll be able to:
              </p>
              <ul className="text-xs text-gray-600 space-y-1 pl-4 list-disc">
                <li>Upload your dead-lead list</li>
                <li>Review and approve message previews before they go out</li>
                <li>Monitor live replies as they come in</li>
                <li>Pause messaging anytime</li>
              </ul>
            </div>
            <p className="text-xs text-emerald-700 font-semibold pt-1">
              No messages are active until your first batch is reviewed.
            </p>
          </div>

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
