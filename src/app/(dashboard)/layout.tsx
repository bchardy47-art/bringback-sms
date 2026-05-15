import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { and, count, eq } from 'drizzle-orm'
import Image from 'next/image'
import { Bell, Search } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { conversations, tenants } from '@/lib/db/schema'
import { SidebarNav } from '@/components/layout/SidebarNav'
import { MobileBottomNav } from '@/components/layout/MobileBottomNav'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const initials = session.user.name
    ? session.user.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'U'

  const [[tenantRow], [openRow]] = await Promise.all([
    db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, session.user.tenantId)),
    db
      .select({ count: count() })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, session.user.tenantId),
          eq(conversations.status, 'open'),
        ),
      ),
  ])

  const tenantName = tenantRow?.name ?? 'My Dealership'
  const inboxCount = openRow?.count ?? 0

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
        <div className="flex-1 overflow-y-auto">
          <SidebarNav inboxCount={inboxCount} />
        </div>

        {/* Dealership card */}
        <div
          className="mx-3 mb-3 rounded-2xl overflow-hidden flex-shrink-0"
          style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          {/* Photo banner — gradient with subtle grid texture */}
          <div
            className="w-full h-16 flex items-center justify-center overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, #1a1f2e 0%, #0d1117 60%, #1a0505 100%)',
            }}
          >
            <Image
              src="/dlr-logo.svg"
              alt=""
              width={110}
              height={34}
              aria-hidden="true"
              style={{ opacity: 0.25, width: 110, height: 'auto' }}
            />
          </div>

          {/* Info */}
          <div className="px-3 pt-3 pb-3">
            <p className="text-white text-sm font-bold truncate leading-tight">{tenantName}</p>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Dead Lead Revival
            </p>
            <button
              className="mt-3 w-full py-2 text-xs font-semibold rounded-xl transition-colors text-center"
              style={{
                backgroundColor: 'rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.7)',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              View Dealership Profile
            </button>
          </div>
        </div>

        {/* User row */}
        <div
          className="px-4 py-3.5 flex-shrink-0 flex items-center gap-2.5"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          {/* Avatar with green online dot */}
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
            <p className="text-xs truncate capitalize" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {session.user.role ?? 'Agent'}
            </p>
          </div>

          {/* Sign out as a chevron/menu trigger */}
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
        <header className="flex-shrink-0 bg-white flex items-center gap-3 px-4 md:px-8 py-3" style={{ borderBottom: '1px solid #e5e7eb' }}>
          {/* Mobile logo (hidden on desktop since sidebar has it) */}
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

          {/* Search */}
          <div className="flex-1 max-w-md relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: '#9ca3af' }}
            />
            <input
              type="text"
              placeholder="Search..."
              readOnly
              className="w-full pl-9 pr-3 md:pr-12 py-2 text-sm rounded-lg bg-gray-50 placeholder-gray-400 text-gray-700 focus:outline-none"
              style={{ border: '1px solid #e5e7eb' }}
            />
            <kbd
              className="hidden md:block absolute right-3 top-1/2 -translate-y-1/2 text-xs rounded px-1.5 py-0.5"
              style={{ color: '#9ca3af', backgroundColor: '#f3f4f6', border: '1px solid #e5e7eb' }}
            >
              ⌘K
            </kbd>
          </div>

          <div className="flex items-center gap-2 md:gap-3 ml-auto">
            {/* Bell */}
            <button
              className="relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-gray-100"
              aria-label="Notifications"
            >
              <Bell size={18} style={{ color: '#6b7280' }} />
              {inboxCount > 0 && (
                <span
                  className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full text-white flex items-center justify-center font-bold"
                  style={{ backgroundColor: '#dc2626', fontSize: 9 }}
                >
                  {inboxCount > 9 ? '9+' : inboxCount}
                </span>
              )}
            </button>

            {/* Avatar */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: '#1f2937' }}
                >
                  {initials}
                </div>
                <span
                  className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white"
                  style={{ backgroundColor: '#22c55e' }}
                />
              </div>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M3 4.5L6 7.5L9 4.5"
                  stroke="#9ca3af"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto pb-16 md:pb-0">{children}</main>
      </div>

      {/* ── Mobile bottom nav ── */}
      <MobileBottomNav inboxCount={inboxCount} />
    </div>
  )
}
