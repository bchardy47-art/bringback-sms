import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import Image from 'next/image'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { DealerNav } from '@/components/dealer/DealerNav'

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

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#f4f5f7' }}>
      {/* ── Sidebar (desktop only) ── */}
      <aside
        className="hidden md:flex w-[220px] flex-shrink-0 flex-col overflow-hidden"
        style={{ backgroundColor: '#0f1015' }}
      >
        {/* Logo */}
        <div
          className="px-4 py-3 flex-shrink-0 flex items-center justify-center"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <Image
            src="/dlr-logo.svg"
            alt="DLR — Dead Lead Revival"
            width={192}
            height={60}
            priority
            style={{ width: '100%', maxWidth: 192, height: 'auto' }}
          />
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-3">
          <DealerNav />
        </div>

        {/* Dealership card */}
        <div
          className="mx-3 mb-3 rounded-2xl overflow-hidden flex-shrink-0"
          style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div
            className="w-full h-12 flex items-center justify-center overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #1a1f2e 0%, #0d1117 60%, #1a0505 100%)' }}
          >
            <Image
              src="/dlr-logo.svg"
              alt=""
              width={90}
              height={28}
              aria-hidden="true"
              style={{ opacity: 0.2, width: 90, height: 'auto' }}
            />
          </div>
          <div className="px-3 pt-2.5 pb-3">
            <p className="text-white text-sm font-bold truncate leading-tight">{tenantName}</p>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Dead Lead Revival
            </p>
          </div>
        </div>

        {/* User row */}
        <div
          className="px-4 py-3.5 flex-shrink-0 flex items-center gap-2.5"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="relative flex-shrink-0">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{ backgroundColor: '#374151' }}
            >
              {initials}
            </div>
            <span
              className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: '#22c55e', border: '2px solid #0f1015' }}
            />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-semibold truncate leading-tight">
              {session.user.name}
            </p>
            <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Dealer
            </p>
          </div>

          <form action="/api/auth/signout" method="post">
            <button
              type="submit"
              className="flex items-center justify-center w-6 h-6 rounded-md transition-colors hover:bg-white/10"
              title="Sign out"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M5 3.5L8 7L5 10.5"
                  stroke="rgba(255,255,255,0.3)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </form>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header
          className="flex-shrink-0 bg-white flex items-center gap-3 px-4 md:px-8 py-3"
          style={{ borderBottom: '1px solid #e5e7eb' }}
        >
          {/* Mobile logo */}
          <div className="flex md:hidden flex-shrink-0">
            <Image
              src="/dlr-logo.svg"
              alt="DLR"
              width={72}
              height={24}
              priority
              style={{ width: 72, height: 'auto' }}
            />
          </div>

          <div className="flex-1" />

          {/* Dealership name (top bar, desktop) */}
          <span className="hidden md:block text-sm font-semibold text-gray-700">{tenantName}</span>

          {/* Avatar + sign out */}
          <div className="flex items-center gap-2 ml-auto md:ml-0">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{ backgroundColor: '#1f2937' }}
            >
              {initials}
            </div>
          </div>
        </header>

        {/* Mobile nav — horizontal pill strip */}
        <nav
          className="flex md:hidden gap-1 overflow-x-auto px-3 py-2 bg-white"
          style={{ borderBottom: '1px solid #e5e7eb' }}
        >
          {[
            { href: '/dealer/dashboard', label: 'Dashboard' },
            { href: '/dealer/import',    label: 'Import Leads' },
            { href: '/dealer/batches',   label: 'Batches' },
            { href: '/dealer/inbox',     label: 'Inbox' },
          ].map(({ href, label }) => (
            <a
              key={href}
              href={href}
              className="flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-full text-gray-600 hover:bg-gray-100 transition-colors"
            >
              {label}
            </a>
          ))}
        </nav>

        {/* Page content */}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
