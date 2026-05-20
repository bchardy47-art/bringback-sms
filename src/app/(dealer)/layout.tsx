import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import Image from 'next/image'
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
        {/* DLR brand accent line at top */}
        <div
          style={{
            height: 3,
            flexShrink: 0,
            background: 'linear-gradient(90deg, #7f1d1d, #dc2626 40%, #ef4444 70%, #dc2626)',
          }}
        />

        {/* Logo — new PNG ships with its own dark background baked in
            (3:1 aspect, 2172×724 source). Drop it directly on the dark
            sidebar without the prior white container so the brand mark
            blends cleanly. object-contain keeps it sharp at the 150px
            display width on desktop. */}
        <div
          className="px-5 py-6 flex-shrink-0 flex items-center justify-center"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <Image
            src="/brand/dlr-logo.png"
            alt="DLR — Dead Lead Revival"
            width={150}
            height={50}
            priority
            unoptimized
            className="object-contain"
            style={{ width: '100%', maxWidth: 150, height: 'auto', display: 'block' }}
          />
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-4">
          <DealerNav />
        </div>

        {/* Dealership card */}
        <div
          className="mx-3 mb-3 rounded-xl overflow-hidden flex-shrink-0"
          style={{
            backgroundColor: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {/* Red accent stripe */}
          <div style={{ height: 2, background: 'linear-gradient(90deg, #dc2626, #ef4444)' }} />
          <div className="flex items-center gap-2.5 px-3 py-3">
            <div
              className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-white font-bold"
              style={{ backgroundColor: '#991b1b', fontSize: 11, letterSpacing: '0.02em' }}
            >
              {tenantInitials}
            </div>
            <div className="min-w-0">
              <p className="text-white text-xs font-bold truncate leading-tight">{tenantName}</p>
              <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Dead Lead Revival
              </p>
            </div>
          </div>
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
          {/* Mobile logo — top bar is white, so we use the SVG (which is
              transparent / dark-on-light) rather than the dark-baked PNG
              that lives in the desktop dark sidebar. Aspect 3.3:1 matches
              the SVG's natural ratio (160×48). */}
          <div className="flex md:hidden flex-shrink-0">
            <Image
              src="/dlr-logo.svg"
              alt="DLR"
              width={120}
              height={36}
              priority
              style={{ maxWidth: 120, width: '100%', height: 'auto', display: 'block' }}
            />
          </div>

          <div className="flex-1" />

          {/* Dealership name + badge (desktop) */}
          <div className="hidden md:flex items-center gap-2">
            <span
              className="inline-flex items-center justify-center rounded font-bold text-white"
              style={{
                backgroundColor: '#dc2626',
                width: 20,
                height: 20,
                fontSize: 9,
                letterSpacing: '0.02em',
                flexShrink: 0,
              }}
            >
              {tenantInitials}
            </span>
            <span className="text-sm font-semibold text-gray-700">{tenantName}</span>
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
