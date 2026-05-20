import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { User, Shield, CreditCard } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { users, dealerIntakes } from '@/lib/db/schema'
import { DealerProfileEditForm } from '@/components/dealer/DealerProfileEditForm'
import { ChangePasswordForm } from '@/components/settings/ChangePasswordForm'
import { BillingPortalButton } from '@/components/settings/BillingPortalButton'

export default async function DealerSettingsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/dealer/settings')
  if (session.user.role !== 'dealer') redirect('/settings')

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { name: true, email: true },
  })

  // Billing context: same lookup as the admin settings page — most-recent
  // intake row for this tenant that has a Stripe customer attached.
  const billingIntake = await db.query.dealerIntakes.findFirst({
    where: and(
      eq(dealerIntakes.tenantId, session.user.tenantId),
      isNotNull(dealerIntakes.stripeCustomerId),
    ),
    orderBy: [desc(dealerIntakes.activatedAt)],
    columns: { stripeCustomerId: true, paymentStatus: true, plan: true },
  })

  // Recovery path for the "no billing on file" state: find ANY intake for
  // this tenant so we can deep-link the dealer back to /intake/<token>/payment.
  // Only fetched when there's no billing intake — otherwise the dealer
  // already has the Stripe portal button and doesn't need a recovery link.
  // Token is used solely as the URL credential for the recovery link;
  // never rendered as visible text. If no intake row exists (admin-provisioned
  // tenant without an intake), recoveryHref stays null and the UI falls
  // back to a support contact prompt.
  const recoveryIntake = billingIntake
    ? null
    : await db.query.dealerIntakes.findFirst({
        where: eq(dealerIntakes.tenantId, session.user.tenantId),
        orderBy: [desc(dealerIntakes.createdAt)],
        columns: { token: true },
      })
  const recoveryHref = recoveryIntake
    ? `/intake/${recoveryIntake.token}/payment`
    : null

  const name = user?.name ?? session.user.name ?? ''
  const email = user?.email ?? session.user.email ?? ''

  return (
    <div className="min-h-full bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-8 py-5">
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your Revival Center account</p>
      </div>

      <div className="px-8 py-6 max-w-3xl space-y-5">
        {/* Account */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
            <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center">
              <User size={18} className="text-blue-500" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Account</h2>
              <p className="text-xs text-gray-400">Your dealer profile</p>
            </div>
          </div>
          <DealerProfileEditForm initialName={name} email={email} />
        </div>

        {/* Billing — Stripe-hosted self-serve portal */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
            <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center">
              <CreditCard size={18} className="text-emerald-500" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Billing</h2>
              <p className="text-xs text-gray-400">
                {billingIntake?.plan
                  ? `${billingIntake.plan.charAt(0).toUpperCase() + billingIntake.plan.slice(1)} plan`
                  : 'Manage your subscription'}
              </p>
            </div>
          </div>
          <BillingPortalButton
            hasCustomer={Boolean(billingIntake?.stripeCustomerId)}
            paymentStatus={billingIntake?.paymentStatus ?? null}
            recoveryHref={recoveryHref}
          />
        </div>

        {/* Security — change password */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
            <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center">
              <Shield size={18} className="text-violet-500" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Security</h2>
              <p className="text-xs text-gray-400">Change your password</p>
            </div>
          </div>
          <ChangePasswordForm />
        </div>
      </div>
    </div>
  )
}
