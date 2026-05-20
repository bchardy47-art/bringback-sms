import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { DealerNav } from '@/components/dealer/DealerNav'
import { DealerMobileNav } from '@/components/dealer/DealerMobileNav'
import { AccountMenu } from '@/components/layout/AccountMenu'

export default async function DealerLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'dealer') redirect('/dashboard')

  const initials = session.user.name
    ? session.user.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'U'

  const [tenantRow] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, session.user.tenantId))

  const tenantName = tenantRow?.name ?? 'My Dealership'
  const tenantInitials = tenantName
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#f4f5f7' }}>

      {/* ── Sidebar (desktop only) ── */}
      <aside
        className="hidden md:flex w-[220px] flex-shrink-0 flex-col overflow-hidden"
        style={{
          backgroundColor: '#0c0e13',
          borderRight: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {/* Red brand accent line at top */}
        <div
          style={{
            height: 3,
            flexShrink: 0,
            background: 'linear-gradient(90deg, #7f1d1d, #dc2626 40%, #ef4444 70%, #dc2626)',
          }}
        />

        {/* Dealer-first identity block. The dealership name is the primary
            brand for the dealer workspace; the small "by DLR" line keeps
            vendor context without dominating the surface. Replaces the
            full-width DLR logo that previously made the sidebar feel like
            a billboard. */}
        <div
          className="px-4 py-5 flex items-center gap-3 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div
            className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center text-white font-black"
            style={{
              background: 'linear-gradient(135deg, #991b1b, #dc2626)',
              fontSize: 13,
              letterSpacing: '0.04em',
              boxShadow: '0 1px 0 rgba(255,255,255,0.08) inset',
            }}
          >
            {tenantInitials}
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-bold truncate leading-tight">{tenantName}</p>
            <p
              className="text-[11px] truncate leading-tight mt-0.5"
              style={{ color: 'rgba(255,255,255,0.55)' }}
            >
              Revival Center
            </p>
            <p
              className="text-[9px] uppercase tracking-[0.18em] mt-1 leading-tight"
              style={{ color: 'rgba(255,255,255,0.28)' }}
            >
              by DLR
            </p>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-4">
          <DealerNav />
        </div>

        {/* User row */}
        <div
          className="px-4 py-3.5 flex-shrink-0 flex items-center gap-2.5"
          style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="relative flex-shrink-0">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{
                backgroundColor: '#7f1d1d',
                border: '1.5px solid rgba(220,38,38,0.35)',
              }}
            >
              {initials}
            </div>
            <span
              className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: '#22c55e', border: '2px solid #0c0e13' }}
            />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-semibold truncate leading-tight">
              {session.user.name}
            </p>
            <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.38)' }}>
              Dealer
            </p>
          </div>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar */}
        <header
          className="flex-shrink-0 bg-white flex items-center gap-3 px-4 md:px-6"
          style={{ borderBottom: '1px solid #e5e7eb', height: 56 }}
        >
          {/* Mobile dealer identity — replaces the prior DLR logo so the
              mobile top bar leads with the dealership, not the vendor. */}
          <div className="flex md:hidden items-center gap-2 flex-shrink-0 min-w-0">
            <span
              className="inline-flex items-center justify-center rounded-lg text-white font-black"
              style={{
                background: 'linear-gradient(135deg, #991b1b, #dc2626)',
                width: 28,
                height: 28,
                fontSize: 11,
                letterSpacing: '0.03em',
                flexShrink: 0,
              }}
            >
              {tenantInitials}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate leading-tight">{tenantName}</p>
              <p className="text-[10px] text-gray-400 truncate leading-tight">Revival Center</p>
            </div>
          </div>

          <div className="flex-1" />

          {/* Dealership name + badge (desktop) */}
          <div className="hidden md:flex items-center gap-2">
            <span
              className="inline-flex items-center justify-center rounded font-bold text-white"
              style={{
                backgroundColor: '#dc2626',
                width: 22,
                height: 22,
                fontSize: 10,
                letterSpacing: '0.02em',
                flexShrink: 0,
              }}
            >
              {tenantInitials}
            </span>
            <div className="leading-tight">
              <span className="text-sm font-semibold text-gray-800 block">{tenantName}</span>
              <span className="text-[10px] text-gray-400 block uppercase tracking-wider">
                Revival Center
              </span>
            </div>
          </div>

          {/* Account menu */}
          <div className="flex items-center ml-3 md:ml-0">
            <AccountMenu
              name={session.user.name ?? 'Account'}
              email={session.user.email ?? ''}
              initials={initials}
              settingsHref="/dealer/settings"
            />
          </div>
        </header>

        {/* Mobile nav — active-state aware client component */}
        <DealerMobileNav />

        {/* Page content + persistent support footer.
            Main is flex-column so the support line stays pinned at the
            bottom of the viewport regardless of child content height. */}
        <main className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 overflow-auto">{children}</div>
          <footer
            className="flex-shrink-0 px-4 md:px-6 py-2.5 bg-white flex items-center justify-center gap-1 text-xs text-gray-400"
            style={{ borderTop: '1px solid #e5e7eb' }}
          >
            Need help?{' '}
            <a
              href="mailto:support@dlr-sms.com"
              className="text-gray-600 hover:text-gray-900 font-medium underline ml-1"
            >
              Contact DLR Support
            </a>
          </footer>
        </main>
      </div>
    </div>
  )
}
