import { redirect } from 'next/navigation'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { User, Shield, CreditCard, Building2, Headphones, Rocket } from 'lucide-react'
import { getDealerSession } from '@/lib/dealer/dev-auth-bypass'
import { db } from '@/lib/db'
import { users, tenants, dealerIntakes } from '@/lib/db/schema'
import { DealerProfileEditForm } from '@/components/dealer/DealerProfileEditForm'
import { ChangePasswordForm } from '@/components/settings/ChangePasswordForm'
import { BillingPortalButton } from '@/components/settings/BillingPortalButton'

export default async function DealerSettingsPage() {
  const session = await getDealerSession()
  if (!session) redirect('/login?callbackUrl=/dealer/settings')
  if (session.user.role !== 'dealer') redirect('/settings')

  // Tenant + user + dealership profile — all read in parallel
  const [[tenantRow], [userRow], profileIntake] = await Promise.all([
    db.select({ name: tenants.name, smsLiveApproved: tenants.smsLiveApproved })
      .from(tenants)
      .where(eq(tenants.id, session.user.tenantId))
      .limit(1),
    db.select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1),
    db.query.dealerIntakes.findFirst({
      where: eq(dealerIntakes.tenantId, session.user.tenantId),
      orderBy: [desc(dealerIntakes.createdAt)],
      columns: {
        dealershipName:      true,
        primaryContactName:  true,
        primaryContactEmail: true,
        primaryContactPhone: true,
        approvedSenderName:  true,
        businessWebsite:     true,
      },
    }),
  ])

  // Billing context: most-recent intake row that has a Stripe customer attached.
  const billingIntake = await db.query.dealerIntakes.findFirst({
    where: and(
      eq(dealerIntakes.tenantId, session.user.tenantId),
      isNotNull(dealerIntakes.stripeCustomerId),
    ),
    orderBy: [desc(dealerIntakes.activatedAt)],
    columns: { stripeCustomerId: true, paymentStatus: true, plan: true },
  })

  // Recovery path for "no billing on file": deep-link back to payment step.
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

  // Prefer DB over session fallback; treat empty strings as missing.
  // Display-only fallback: 'Admin' placeholder reads as unfilled — show 'Dealership Admin' instead.
  const nameRaw = userRow?.name?.trim() || session.user.name?.trim() || ''
  const name    = (!nameRaw || nameRaw.toLowerCase() === 'admin') ? 'Dealership Admin' : nameRaw
  const email   = userRow?.email?.trim() || session.user.email?.trim() || ''

  // Read-only dealership profile values (never expose UUIDs or sending numbers)
  const dealershipDisplayName = profileIntake?.dealershipName  || tenantRow?.name  || null
  const approvedSenderName    = profileIntake?.approvedSenderName    || null
  const primaryContactName    = profileIntake?.primaryContactName    || null
  const primaryContactPhone   = profileIntake?.primaryContactPhone   || null
  const businessWebsite       = profileIntake?.businessWebsite       || null
  // Show contact email only when it differs from the login email (avoid duplication)
  const showContactEmail = (() => {
    const v = profileIntake?.primaryContactEmail?.trim().toLowerCase()
    return v && v !== email.toLowerCase() ? profileIntake!.primaryContactEmail! : null
  })()

  const isLive = !!tenantRow?.smsLiveApproved

  return (
    <div style={{ color: 'var(--tx)', fontFamily: 'var(--f-body)' }}>

      {/* Page header */}
      <div style={{
        padding: '24px 32px',
        borderBottom: '1px solid var(--line-red)',
        background: 'rgba(255,27,27,0.03)',
      }}>
        <p className="eyebrow red" style={{ marginBottom: 6 }}>Revival Center</p>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--tx-hi)', letterSpacing: '-0.015em', lineHeight: 1.1 }}>
          Settings
        </h1>
        <p style={{ color: 'var(--tx-mid)', fontSize: 14, marginTop: 6, lineHeight: 1.4 }}>
          Manage your account and dealership preferences
        </p>
      </div>

      <div style={{ padding: '24px 32px 40px', display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* ── Left column: account cards ── */}
        <div style={{ flex: '1 1 480px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 680 }}>

        {/* ── Dealership Profile (read-only) ── */}
        <div className="glass" style={{ padding: 'var(--pad)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 9,
              background: 'rgba(255,42,42,0.10)',
              border: '1px solid rgba(255,42,42,0.22)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Building2 size={16} style={{ color: '#ff5252' }} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="card-title">Dealership Profile</div>
              <div style={{ fontSize: 12, color: 'var(--tx-lo)', marginTop: 2 }}>
                Verified for compliance. Contact DLR support to request changes.
              </div>
            </div>
            {isLive ? (
              <span className="badge badge-red">Live</span>
            ) : (
              <span className="badge badge-ghost">Setup in progress</span>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px 28px' }}>
            {dealershipDisplayName && <ProfileField label="Dealership Name"   value={dealershipDisplayName} />}
            {approvedSenderName    && <ProfileField label="Sender Name"       value={approvedSenderName}    />}
            {primaryContactName    && <ProfileField label="Primary Contact"   value={primaryContactName}    />}
            {showContactEmail      && <ProfileField label="Contact Email"     value={showContactEmail}      />}
            {primaryContactPhone   && <ProfileField label="Contact Phone"     value={primaryContactPhone}   />}
            {businessWebsite       && <ProfileField label="Website"           value={businessWebsite}       />}
          </div>

          <p style={{
            fontSize: 12, color: 'var(--tx-lo)', marginTop: 20, lineHeight: 1.6,
            borderTop: '1px solid var(--line)', paddingTop: 14,
          }}>
            Need to update sender details, business info, or launch settings?{' '}
            <a href="mailto:support@dlr-sms.com" style={{ color: 'var(--red-core)', textDecoration: 'none' }}>
              Contact DLR Support
            </a>
            .
          </p>
        </div>

        {/* ── Account ── */}
        <div className="glass" style={{ padding: 'var(--pad)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 9,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.10)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <User size={16} style={{ color: 'var(--tx-mid)' }} />
            </div>
            <div>
              <div className="card-title">Account</div>
              <div style={{ fontSize: 12, color: 'var(--tx-lo)', marginTop: 2 }}>Your personal profile</div>
            </div>
          </div>
          <DealerProfileEditForm initialName={name} email={email} />
        </div>

        {/* ── Billing ── */}
        <div className="glass" style={{ padding: 'var(--pad)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 9,
              background: 'rgba(34,197,94,0.09)',
              border: '1px solid rgba(34,197,94,0.22)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <CreditCard size={16} style={{ color: '#4ade80' }} />
            </div>
            <div>
              <div className="card-title">Billing</div>
              <div style={{ fontSize: 12, color: 'var(--tx-lo)', marginTop: 2 }}>
                {billingIntake?.plan
                  ? `${billingIntake.plan.charAt(0).toUpperCase() + billingIntake.plan.slice(1)} plan`
                  : 'Subscription & payment'}
              </div>
            </div>
          </div>
          <BillingPortalButton
            hasCustomer={Boolean(billingIntake?.stripeCustomerId)}
            paymentStatus={billingIntake?.paymentStatus ?? null}
            recoveryHref={recoveryHref}
          />
        </div>

        {/* ── Security ── */}
        <div className="glass" style={{ padding: 'var(--pad)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 9,
              background: 'rgba(167,139,250,0.09)',
              border: '1px solid rgba(167,139,250,0.22)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Shield size={16} style={{ color: '#a78bfa' }} />
            </div>
            <div>
              <div className="card-title">Security</div>
              <div style={{ fontSize: 12, color: 'var(--tx-lo)', marginTop: 2 }}>Change your password</div>
            </div>
          </div>
          <ChangePasswordForm />
        </div>

        </div>{/* end left column */}

        {/* ── Right column: Pilot Support panel ── */}
        <div style={{ flex: '0 1 300px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Pilot status chip */}
          <div style={{
            borderRadius: 12,
            padding: '14px 16px',
            background: 'rgba(34,197,94,0.06)',
            border: '1px solid rgba(34,197,94,0.15)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Rocket size={13} style={{ color: '#4ade80', flexShrink: 0 }} />
              <span style={{
                fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: '#4ade80',
              }}>
                Pilot Active
              </span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--tx-mid)', lineHeight: 1.55 }}>
              You are in a free pilot phase. Billing is not required to explore your campaigns.
              Your DLR team will guide you through launch.
            </p>
          </div>

          {/* Support card */}
          <div className="glass" style={{ padding: 'var(--pad)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 9,
                background: 'rgba(255,42,42,0.10)',
                border: '1px solid rgba(255,42,42,0.22)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Headphones size={15} style={{ color: '#ff5252' }} />
              </div>
              <div>
                <div className="card-title">DLR Launch Support</div>
                <div style={{ fontSize: 12, color: 'var(--tx-lo)', marginTop: 2 }}>Your pilot team</div>
              </div>
            </div>

            <p style={{ fontSize: 13, color: 'var(--tx-mid)', lineHeight: 1.55, marginBottom: 14 }}>
              Need help? Email support@dlr-sms.com. DLR will respond within 1 business day during setup.
            </p>

            <a
              href="mailto:support@dlr-sms.com"
              className="btn"
              style={{ height: 36, fontSize: 13, textDecoration: 'none', width: '100%', justifyContent: 'center' }}
            >
              Email Support
            </a>

            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <p style={{ fontSize: 11, color: 'var(--tx-lo)', lineHeight: 1.55 }}>
                To update your dealership profile, sender name, or launch settings, email{' '}
                <a href="mailto:support@dlr-sms.com" style={{ color: 'var(--red-core)', textDecoration: 'none' }}>
                  support@dlr-sms.com
                </a>{' '}
                and DLR will handle it.
              </p>
            </div>
          </div>

        </div>{/* end right column */}

      </div>
    </div>
  )
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
        textTransform: 'uppercase', color: 'var(--tx-lo)', marginBottom: 5,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: 'var(--tx-hi)', lineHeight: 1.4, wordBreak: 'break-word' }}>
        {value}
      </div>
    </div>
  )
}
