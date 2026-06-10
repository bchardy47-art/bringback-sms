import { redirect } from 'next/navigation'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { User, Shield, CreditCard } from 'lucide-react'
import { getDealerSession } from '@/lib/dealer/dev-auth-bypass'
import { db } from '@/lib/db'
import { users, dealerIntakes } from '@/lib/db/schema'
import { DealerProfileEditForm } from '@/components/dealer/DealerProfileEditForm'
import { ChangePasswordForm } from '@/components/settings/ChangePasswordForm'
import { BillingPortalButton } from '@/components/settings/BillingPortalButton'

export default async function DealerSettingsPage() {
  const session = await getDealerSession()
  if (!session) redirect('/login?callbackUrl=/dealer/settings')
  if (session.user.role !== 'dealer') redirect('/settings')

  // Same fresh DB lookup pattern the dealer layout uses for the sidebar
  // display name, so Settings can never disagree with the sidebar. JWT
  // caches name/email at login and goes stale across profile edits.
  const [userRow] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

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

  // Prefer DB → session fallback. Treat empty strings as missing so the
  // input never renders blank when the JWT/DB happens to carry "".
  const dbName    = userRow?.name?.trim()
  const dbEmail   = userRow?.email?.trim()
  const sessName  = session.user.name?.trim()
  const sessEmail = session.user.email?.trim()
  const name  = dbName  || sessName  || ''
  const email = dbEmail || sessEmail || ''

  return (
    <div className="dlr-app-bg min-h-full text-white">
      <div
        className="px-8 py-5"
        style={{ borderBottom: '1px solid rgba(255,27,27,0.28)' }}
      >
        <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>Account Settings</p>
        <h1 className="text-xl font-black text-white mt-1">Settings</h1>
        <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>Manage your Revival Center account</p>
      </div>

      <div className="px-8 py-6 max-w-3xl space-y-5">
        {/* Account */}
        <div className="dlr-card overflow-hidden">
          <div
            className="flex items-center gap-3 px-6 py-4"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{
                background: 'rgba(59,130,246,0.15)',
                border: '1px solid rgba(59,130,246,0.25)',
              }}
            >
              <User size={18} style={{ color: '#60a5fa' }} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Account</h2>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>Your dealer profile</p>
            </div>
          </div>
          <DealerProfileEditForm initialName={name} email={email} />
        </div>

        {/* Billing — Stripe-hosted self-serve portal */}
        <div className="dlr-card overflow-hidden">
          <div
            className="flex items-center gap-3 px-6 py-4"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{
                background: 'rgba(16,185,129,0.15)',
                border: '1px solid rgba(16,185,129,0.25)',
              }}
            >
              <CreditCard size={18} style={{ color: '#34d399' }} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Billing</h2>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
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
        <div className="dlr-card overflow-hidden">
          <div
            className="flex items-center gap-3 px-6 py-4"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{
                background: 'rgba(139,92,246,0.15)',
                border: '1px solid rgba(139,92,246,0.25)',
              }}
            >
              <Shield size={18} style={{ color: '#a78bfa' }} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Security</h2>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>Change your password</p>
            </div>
          </div>
          <ChangePasswordForm />
        </div>
      </div>
    </div>
  )
}
