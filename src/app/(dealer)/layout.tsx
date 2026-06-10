import { redirect } from 'next/navigation'
import Image from 'next/image'
import { and, count, eq } from 'drizzle-orm'
import { Bell, MessageSquare, ArrowRight, Settings } from 'lucide-react'
import { db } from '@/lib/db'
import { conversations, tenants, users } from '@/lib/db/schema'
import { DealerNav } from '@/components/dealer/DealerNav'
import { DealerMobileNav } from '@/components/dealer/DealerMobileNav'
import { AccountMenu } from '@/components/layout/AccountMenu'
import { EKG } from '@/components/dealer/EKG'
import { getDealerSessionWithSource } from '@/lib/dealer/dev-auth-bypass'

// ── Tachometer segment patterns (24 segs, top → bottom) ──────────────────────
// Ordered so highest-intensity segs are visually near the top of the gauge.
const TACH_LIVE: string[] = [
  'off', 'off', 'off',
  'peak live', 'hot live', 'hot live', 'hot',
  'on', 'on', 'on', 'on', 'on', 'on', 'on', 'on', 'on', 'on', 'on',
  'dim', 'dim', 'dim', 'dim', 'dim', 'dim',
]

const TACH_STANDBY: string[] = [
  'off', 'off', 'off', 'off', 'off', 'off', 'off', 'off', 'off', 'off',
  'hot', 'on', 'on', 'on', 'on',
  'dim', 'dim', 'dim', 'dim', 'dim', 'dim', 'dim', 'dim', 'dim',
]

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

  const tachSegs  = isLive ? TACH_LIVE : TACH_STANDBY
  const powerValue = isLive ? 100 : 45
  // Needle position as percentage from the top of the tach track.
  // Live = needle between seg 3 and 4 (peak zone); standby = seg 9 and 10.
  const needleTopPct = isLive ? 12.5 : 40.5

  return (
    <>
      {/* ── Ambient background layers (fixed, behind .app grid) ── */}
      <div className="bg-field" aria-hidden="true" />
      <div className="bg-grid"  aria-hidden="true" />
      <div className="bg-bloom" aria-hidden="true" />

      <div className="app">

        {/* ══════════════════════════════════════════════════
            SIDEBAR (hidden on mobile via CSS — see globals)
            ══════════════════════════════════════════════════ */}
        <aside className="side">

          {/* Brand logo */}
          <div className="brand">
            <Image
              src="/brand/dlr-logo.png"
              alt="DLR — Dead Lead Revival"
              width={200}
              height={62}
              priority
              className="brand-img"
            />
          </div>

          {/* Org / dealership identity pill */}
          <div className="org-switch">
            <div className="org-badge" aria-hidden="true">
              {tenantInitials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontWeight: 700,
                fontSize: 14,
                color: 'var(--tx-hi)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                lineHeight: 1.2,
              }}>
                {tenantName}
              </div>
              <div className="eyebrow" style={{ marginTop: 2 }}>Revival Center</div>
            </div>
          </div>

          {/* Navigation links */}
          <nav className="nav" aria-label="Dealer navigation">
            <DealerNav inboxCount={inboxCount} />
          </nav>

          {/* ── Vertical tachometer power gauge ── */}
          <div className="power-block">
            <div className="power-label">DLR Power Level</div>
            <div className="power-gauge-wrap">
              <div className="power-info">
                <div className="power-value">
                  {powerValue}<span>%</span>
                </div>
                <div className="power-foot">
                  {isLive ? 'Engines hot — leads are being revived.' : 'Complete setup to ignite revival mode.'}
                </div>
                {isLive ? (
                  <a href="/dealer/batches" className="link-red" style={{ fontSize: 11, marginTop: 6 }}>
                    View pipeline <ArrowRight size={11} />
                  </a>
                ) : (
                  <a href="/dealer/settings" className="link-red" style={{ fontSize: 11, marginTop: 6 }}>
                    Complete setup <ArrowRight size={11} />
                  </a>
                )}
              </div>
              <div className="gauge">
                <div className="tach-label">Power</div>
                <div className="tach" style={{ position: 'relative' }}>
                  {tachSegs.map((cls, i) => (
                    <div key={i} className={`seg ${cls}`} />
                  ))}
                  <div
                    className="tach-needle"
                    style={{ top: `${needleTopPct}%`, position: 'absolute' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* DEV AUTH BYPASS badge — only renders when the local-only
              env bypass actually substituted a synthetic session. Production
              builds never see this because isDevAuthBypassActive() is
              hard-gated to NODE_ENV !== 'production'. */}
          {bypassActive && (
            <div
              style={{
                margin: '10px 0 4px',
                padding: '6px 10px',
                borderRadius: 8,
                background: 'rgba(245,158,11,0.14)',
                border: '1px solid rgba(245,158,11,0.55)',
                textAlign: 'center',
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: '#fbbf24',
              }}
              title="Local-only dealer auth bypass is active. Disable by removing DLR_DEV_AUTH_BYPASS from .env.local."
            >
              Dev Auth Bypass
            </div>
          )}

          {/* User row */}
          <div className="user-row">
            <div className="avatar" aria-hidden="true">{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontWeight: 600,
                fontSize: 13.5,
                color: 'var(--tx-hi)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                lineHeight: 1.2,
              }}>
                {displayName}
              </div>
              <div className="eyebrow" style={{ marginTop: 2 }}>Dealer Principal</div>
            </div>
            <AccountMenu
              name={displayName}
              email={session.user.email ?? ''}
              initials={initials}
              settingsHref="/dealer/settings"
            />
          </div>
        </aside>

        {/* ══════════════════════════════════════════════════
            MAIN COLUMN
            ══════════════════════════════════════════════════ */}
        <div className="main">

          {/* ── Topbar (76px) ── */}
          <header className="topbar">
            {/* EKG animation in the background */}
            <div className="topbar-ekg" aria-hidden="true">
              <EKG height={76} />
            </div>

            {/* Mobile: compact brand mark */}
            <div className="org-switch" style={{
              display: 'none',
              marginBottom: 0,
              // shown on mobile via CSS — on desktop we hide via inline display:none
              // and the responsive rule in globals.css makes the sidebar handle it
            }}>
              <div className="org-badge" style={{ width: 28, height: 28, fontSize: 11, borderRadius: 8 }}>
                {tenantInitials}
              </div>
            </div>

            {/* Dealer pill (desktop) */}
            <a href="/dealer/settings" className="top-pill" aria-label={`${tenantName} settings`}>
              <div className="org-badge" style={{ width: 28, height: 28, fontSize: 11, borderRadius: 8 }}>
                {tenantInitials}
              </div>
              <div style={{ lineHeight: 1.2 }}>
                <div className="eyebrow" style={{ color: 'var(--tx-lo)' }}>Dealership</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-hi)' }}>{tenantName}</div>
              </div>
            </a>

            {/* System status pill */}
            <div
              className="top-pill"
              style={{ borderColor: isLive ? 'var(--line-redS)' : undefined }}
            >
              <span
                className={isLive ? 'dot dot-live' : 'dot dot-amber'}
                aria-hidden="true"
              />
              <div style={{ lineHeight: 1.2 }}>
                <div className="eyebrow" style={{ color: isLive ? 'var(--red-core)' : 'var(--tx-lo)' }}>
                  System {systemLabel}
                </div>
                <div style={{ fontSize: 12, color: 'var(--tx-mid)' }}>{systemDetail}</div>
              </div>
            </div>

            {/* Dev-auth bypass badge in topbar (desktop) */}
            {bypassActive && (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 11px',
                  borderRadius: 10,
                  background: 'rgba(245,158,11,0.14)',
                  border: '1px solid rgba(245,158,11,0.55)',
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: '#fbbf24',
                  position: 'relative',
                  zIndex: 1,
                }}
                title="Local-only dealer auth bypass is active."
              >
                <span
                  aria-hidden="true"
                  style={{ width: 6, height: 6, borderRadius: '50%', background: '#fbbf24', display: 'inline-block' }}
                />
                Dev Auth Bypass
              </div>
            )}

            <div style={{ flex: 1 }} />

            {/* Inbox icon button */}
            <a href="/dealer/inbox" className="icon-btn" aria-label="Inbox">
              <MessageSquare size={18} />
              {inboxCount > 0 && (
                <span className="nb">{inboxCount > 99 ? '99+' : inboxCount}</span>
              )}
            </a>

            {/* Notifications icon button */}
            <button className="icon-btn" aria-label="Notifications">
              <Bell size={18} />
            </button>

            {/* Settings icon (visible on mobile when sidebar is hidden) */}
            <a href="/dealer/settings" className="icon-btn" aria-label="Settings">
              <Settings size={18} />
            </a>
          </header>

          {/* Mobile bottom nav */}
          <DealerMobileNav inboxCount={inboxCount} />

          {/* Scrollable page content */}
          <main className="scroll" id="dealer-main-scroll">
            {children}
          </main>

          {/* Footer */}
          <footer className="foot">
            <span style={{ color: 'var(--tx-lo)' }}>Need help?</span>
            <div>
              <a href="mailto:support@dlr-sms.com">Contact DLR Support</a>
            </div>
          </footer>
        </div>

      </div>
    </>
  )
}
