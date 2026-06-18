import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'

// Primary admin nav. Kept intentionally short and operator-facing — the
// "developer/debug" surfaces (production, readiness, go-no-go, pre-live,
// first-pilot, pilot-pack, suppression, workflows) still exist as routes
// on disk and are linked from /admin/dlr itself (Today's Tasks, System
// Health panel, per-intake checklist). They were removed from this top
// nav so a new operator sees a 5-step workflow instead of 16 tabs.
const NAV = [
  { href: '/admin/dlr',              label: 'Platform' },
  // "Dealers" points at the tenant-centric view at /admin/dlr/dealers.
  // The intake-centric view (where operators generate new intake links)
  // is still reachable from the dealers page footer + from per-tenant
  // rows ("Open command center" → /admin/dlr/intakes/<id>).
  { href: '/admin/dlr/dealers',      label: 'Dealers' },
  { href: '/admin/dlr/pilot-leads',  label: 'Lead Review' },
  { href: '/admin/dlr/pilot',        label: 'Pilot Batches' },
  { href: '/admin/dlr/live-pilot',   label: 'Send Pilot' },
  { href: '/admin/dlr/handoffs',     label: 'Handoffs' },
  { href: '/admin/dlr/messages',     label: 'Messages' },
  { href: '/admin/dlr/health',       label: 'System Health' },
  { href: '/admin/dlr/demo-leads',   label: 'Demo Requests' },
]

export default async function DlrAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect('/login')
  if (session.user.role !== 'admin') redirect('/')

  return (
    <div className="min-h-full bg-gray-50">
      {/*
        Sub-nav — horizontally scrollable on mobile so the 8 nav items
        plus the "DLR Admin" label never blow out the viewport width.
        Desktop keeps the original single-line look.
      */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-8">
        <div className="flex items-center gap-0.5 md:gap-1 py-2 overflow-x-auto">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider mr-2 md:mr-3 whitespace-nowrap">
            DLR Admin
          </span>
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="px-2.5 md:px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors whitespace-nowrap"
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
      {children}
    </div>
  )
}
