import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'

// Secondary "Setup Pipeline" toolbar. The primary daily admin nav (Command
// Center / Dealers / Campaigns / Outreach / Messages / System) now lives in
// the parent /admin layout and appears on every page. This toolbar is the
// occasional-use, advanced setup/operations surface — onboarding, carrier
// readiness, live-send controls — and only renders inside /admin/dlr/**.
//
// Items duplicated in the primary nav (Command Center, Dealers, Outreach,
// Messages, System Health) were removed here. Nothing is orphaned: the
// advanced routes that were previously only linked inline are now reachable
// from this toolbar.
const NAV = [
  { href: '/admin/dlr',              label: 'Setup Home' },
  { href: '/admin/dlr/intakes',      label: 'Intakes' },
  { href: '/admin/dlr/pilot-leads',  label: 'Lead Review' },
  { href: '/admin/dlr/live-pilot',   label: 'Send Pilot' },
  { href: '/admin/dlr/readiness',    label: 'Readiness' },
  { href: '/admin/dlr/production',   label: 'Production' },
  { href: '/admin/dlr/workflows',    label: 'Workflows' },
  { href: '/admin/dlr/handoffs',     label: 'Handoffs' },
  { href: '/admin/dlr/demo-leads',   label: 'Demo Requests' },
  { href: '/admin/dlr/suppression',  label: 'Suppression' },
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
            Setup Pipeline
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
