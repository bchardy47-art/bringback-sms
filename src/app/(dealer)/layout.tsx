import { redirect } from 'next/navigation'
import Image from 'next/image'
import { and, count, eq } from 'drizzle-orm'
import { Bell, MessageSquare } from 'lucide-react'
import { db } from '@/lib/db'
import { conversations, tenants, users } from '@/lib/db/schema'
import { DealerNav } from '@/components/dealer/DealerNav'
import { DealerMobileNav } from '@/components/dealer/DealerMobileNav'
import { AccountMenu } from '@/components/layout/AccountMenu'
import { getDealerSessionWithSource } from '@/lib/dealer/dev-auth-bypass'

export default async function DealerLayout({ children }: { children: React.ReactNode }) {
  const { session, source } = await getDealerSessionWithSource()
  const bypassActive = source === 'bypass'
  if (!session) redirect('/login')
  if (session.user.role !== 'dealer') redirect('/dashboard')

  const tenantId = session.user.tenantId

  // Re-read user name from DB on every layout render so any Settings update
  // is immediately reflected in the sidebar — JWT caches the name at login
  // time and goes stale if the user edits their profile without re-logging in.
  const [[tenantRow], [userRow], [openRow]] = await Promise.all([
    db.select({ name: tenants.name, smsLiveApproved: tenants.smsLiveApproved })
      .from(tenants)
      .where(eq(tenants.id, tenantId)),
    db.select({ name: users.name }).from(users).where(eq(users.id, session.user.id)),
    db.select({ count: count() })
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.status, 'open'))),
  ])

  const displayName = userRow?.name ?? session.user.name ?? 'User'
  const initials = displayName
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const tenantName = tenantRow?.name ?? 'My Dealership'
  const tenantInitials = tenantName
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const inboxCount = openRow?.count ?? 0
  const isLive = !!tenantRow?.smsLiveApproved
  const systemLabel = isLive ? 'LIVE' : 'STANDBY'
  const systemDetail = isLive ? 'All systems operational' : 'Preparing for launch'

  return (
    <div className="flex h-screen overflow-hidden dlr-app-bg">

      {/* ── Sidebar (desktop only) ── */}
      <aside
        className="hidden md:flex w-[240px] flex-shrink-0 flex-col overflow-hidden relative"
        style={{
          background: 'rgba(3,3,4,0.94)',
          borderRight: '1px solid rgba(255,27,27,0.24)',
          boxShadow: '8px 0 32px rgba(255,27,27,0.08)',
        }}
      >
        {/* Red brand glow line at top */}
        <div
          style={{
            height: 2,
            flexShrink: 0,
            background: 'linear-gradient(90deg, transparent, #ff1b1b 35%, #ff5252 55%, #ff1b1b 75%, transparent)',
            boxShadow: '0 0 14px rgba(255,27,27,0.65)',
          }}
        />

        {/* DLR logo block */}
        <div
          className="px-5 pt-5 pb-4 flex-shrink-0 flex items-center justify-center"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <Image
            src="/brand/dlr-logo.png"
            alt="DLR — Dead Lead Revival"
            width={180}
            height={56}
            priority
            style={{ width: '100%', maxWidth: 180, height: 'auto', filter: 'drop-shadow(0 0 12px rgba(255,27,27,0.4))' }}
          />
        </div>

        {/* Dealer identity card */}
        <div
          className="mx-3 mt-4 mb-2 rounded-xl flex items-center gap-3 px-3 py-3 flex-shrink-0"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div
            className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center text-white font-black"
            style={{
              background: 'linear-gradient(135deg, #ff2929, #8b0909)',
              fontSize: 13,
              letterSpacing: '0.04em',
              boxShadow: '0 0 14px rgba(255,27,27,0.45), inset 0 1px 0 rgba(255,255,255,0.18)',
            }}
          >
            {tenantInitials}
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-bold truncate leading-tight">{tenantName}</p>
            <p
              className="text-[10px] font-bold truncate uppercase tracking-widest mt-0.5"
              style={{ color: 'rgba(255,27,27,0.85)' }}
            >
              Revival Center
            </p>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-3 dlr-scrollbar">
          <DealerNav inboxCount={inboxCount} />
        </div>

        {/* DLR Power Level card */}
        <div className="px-3 pb-3 flex-shrink-0">
          <div
            className="rounded-xl px-3 py-3"
            style={{
              background: 'linear-gradient(180deg, rgba(255,27,27,0.18), rgba(58,5,5,0.55))',
              border: '1px solid rgba(255,27,27,0.45)',
              boxShadow: '0 0 18px rgba(255,27,27,0.32), inset 0 1px 0 rgba(255,255,255,0.06)',
            }}
          >
            <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>DLR Power Level</p>
            <p className="text-white text-lg font-black mt-1 leading-none">{isLive ? 'FULL POWER' : 'CHARGING'}</p>
            <div
              className="mt-2 h-1.5 rounded-full overflow-hidden"
              style={{ background: 'rgba(0,0,0,0.55)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: isLive ? '100%' : '45%',
                  background: 'linear-gradient(90deg, #ff2929, #ff5252)',
                  boxShadow: '0 0 10px rgba(255,27,27,0.7)',
                }}
              />
            </div>
            <p className="text-[10px] mt-2 leading-tight" style={{ color: 'rgba(255,255,255,0.55)' }}>
              {isLive ? 'Engines hot — leads are being revived.' : 'Complete setup to ignite revival mode.'}
            </p>
          </div>
        </div>

        {/* User row */}
        <div
          className="px-4 py-3 flex-shrink-0 flex items-center gap-2.5"
          style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="relative flex-shrink-0">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{
                background: 'linear-gradient(135deg, #1a0505, #3a0505)',
                border: '1.5px solid rgba(255,27,27,0.5)',
              }}
            >
              {initials}
            </div>
            <span
              className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: '#22c55e', border: '2px solid #030304' }}
            />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-semibold truncate leading-tight">
              {displayName}
            </p>
            <p className="text-[10px] uppercase tracking-widest truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Dealer Principal
            </p>
          </div>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar */}
        <header
          className="flex-shrink-0 flex items-center gap-3 px-4 md:px-6 relative"
          style={{
            background: 'rgba(3,3,4,0.86)',
            borderBottom: '1px solid rgba(255,27,27,0.32)',
            boxShadow: '0 8px 34px rgba(255,27,27,0.08)',
            backdropFilter: 'blur(18px)',
            height: 72,
          }}
        >
          {/* Mobile DLR mark */}
          <div className="flex md:hidden items-center gap-2 flex-shrink-0 min-w-0">
            <span
              className="inline-flex items-center justify-center rounded-lg text-white font-black"
              style={{
                background: 'linear-gradient(135deg, #ff2929, #8b0909)',
                width: 32,
                height: 32,
                fontSize: 11,
                letterSpacing: '0.03em',
                boxShadow: '0 0 12px rgba(255,27,27,0.55)',
              }}
            >
              {tenantInitials}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate leading-tight">{tenantName}</p>
              <p className="text-[10px] uppercase tracking-widest truncate leading-tight" style={{ color: 'rgba(255,27,27,0.85)' }}>
                Revival Center
              </p>
            </div>
          </div>

          {/* Dealer selector card (desktop) */}
          <div
            className="hidden md:flex items-center gap-3 rounded-lg px-3 py-2"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <span
              className="inline-flex items-center justify-center rounded-md text-white font-black"
              style={{
                background: 'linear-gradient(135deg, #ff2929, #8b0909)',
                width: 28,
                height: 28,
                fontSize: 11,
                letterSpacing: '0.03em',
                boxShadow: '0 0 10px rgba(255,27,27,0.5)',
              }}
            >
              {tenantInitials}
            </span>
            <div className="leading-tight">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Dealership
              </p>
              <p className="text-sm font-bold text-white">{tenantName}</p>
            </div>
          </div>

          {/* System status card */}
          <div
            className="hidden md:flex items-center gap-3 rounded-lg px-3 py-2"
            style={{
              background: isLive ? 'rgba(255,27,27,0.08)' : 'rgba(255,255,255,0.04)',
              border: isLive ? '1px solid rgba(255,27,27,0.45)' : '1px solid rgba(255,255,255,0.08)',
              boxShadow: isLive ? '0 0 16px rgba(255,27,27,0.22)' : 'none',
            }}
          >
            <span className="dlr-status-dot" aria-hidden="true" />
            <div className="leading-tight">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: isLive ? '#ff5252' : 'rgba(255,255,255,0.5)' }}>
                System Status {systemLabel}
              </p>
              <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.6)' }}>{systemDetail}</p>
            </div>
          </div>

          {/* DEV AUTH BYPASS badge — only renders when the local-only
              env bypass actually substituted a synthetic session for
              this request. Production builds never see this badge
              because isDevAuthBypassActive() is hard-gated to
              NODE_ENV !== 'production' inside the helper. */}
          {bypassActive && (
            <div
              className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md"
              style={{
                background: 'rgba(245,158,11,0.16)',
                border: '1px solid rgba(245,158,11,0.6)',
                boxShadow: '0 0 12px rgba(245,158,11,0.28)',
              }}
              title="Local-only dealer auth bypass is active. Disable by removing DLR_DEV_AUTH_BYPASS from .env.local."
            >
              <span
                aria-hidden="true"
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: '#fbbf24', boxShadow: '0 0 6px rgba(245,158,11,0.8)' }}
              />
              <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#fbbf24' }}>
                Dev Auth Bypass
              </span>
            </div>
          )}

          <div className="flex-1" />

          {/* Mobile dev-auth badge (icon-only) — keeps the warning
              visible on phone widths where the labelled badge above is
              hidden. */}
          {bypassActive && (
            <span
              className="md:hidden inline-flex items-center justify-center w-7 h-7 rounded-md flex-shrink-0"
              style={{
                background: 'rgba(245,158,11,0.16)',
                border: '1px solid rgba(245,158,11,0.6)',
                boxShadow: '0 0 10px rgba(245,158,11,0.32)',
                color: '#fbbf24',
                fontSize: 10,
                fontWeight: 900,
                letterSpacing: '0.05em',
              }}
              title="Dev auth bypass active"
              aria-label="Dev auth bypass active"
            >
              DEV
            </span>
          )}

          {/* Inbox button */}
          <a
            href="/dealer/inbox"
            className="relative inline-flex items-center justify-center rounded-lg transition-colors"
            style={{
              width: 40,
              height: 40,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.85)',
            }}
            aria-label="Inbox"
          >
            <MessageSquare size={17} />
            {inboxCount > 0 && (
              <span
                className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center font-black text-white"
                style={{
                  background: 'linear-gradient(180deg, #ff2929, #8b0909)',
                  fontSize: 10,
                  boxShadow: '0 0 10px rgba(255,27,27,0.7)',
                  border: '1px solid rgba(255,80,80,0.65)',
                }}
              >
                {inboxCount > 99 ? '99+' : inboxCount}
              </span>
            )}
          </a>

          {/* Notifications */}
          <button
            className="relative inline-flex items-center justify-center rounded-lg transition-colors"
            style={{
              width: 40,
              height: 40,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.85)',
            }}
            aria-label="Notifications"
          >
            <Bell size={17} />
            {inboxCount > 0 && (
              <span
                className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center font-black text-white"
                style={{
                  background: 'linear-gradient(180deg, #ff2929, #8b0909)',
                  fontSize: 10,
                  boxShadow: '0 0 10px rgba(255,27,27,0.7)',
                  border: '1px solid rgba(255,80,80,0.65)',
                }}
              >
                {inboxCount > 9 ? '9+' : inboxCount}
              </span>
            )}
          </button>

          {/* Account menu — styled to fit the dark topbar */}
          <div className="flex items-center">
            <AccountMenu
              name={displayName}
              email={session.user.email ?? ''}
              initials={initials}
              settingsHref="/dealer/settings"
            />
          </div>
        </header>

        {/* Mobile nav */}
        <DealerMobileNav inboxCount={inboxCount} />

        {/* Page content + persistent support footer. */}
        <main className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 overflow-auto dlr-scrollbar">{children}</div>
          <footer
            className="flex-shrink-0 px-4 md:px-6 py-2.5 flex items-center justify-center gap-1 text-xs"
            style={{
              background: 'rgba(3,3,4,0.85)',
              borderTop: '1px solid rgba(255,27,27,0.18)',
              color: 'rgba(255,255,255,0.45)',
            }}
          >
            Need help?{' '}
            <a
              href="mailto:support@dlr-sms.com"
              className="font-bold underline ml-1"
              style={{ color: '#ff5252' }}
            >
              Contact DLR Support
            </a>
          </footer>
        </main>
      </div>
    </div>
  )
}
