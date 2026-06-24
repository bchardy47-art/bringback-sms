import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAdminUser, isBrian } from '@/lib/admin/access'

// Outreach is admin-viewable; the dangerous SEND tools are gated to Brian at
// the action layer (assertBrian). This layout is defense-in-depth on top of the
// (dashboard)/admin layout: any non-admin that reaches here is redirected.
const NAV = [
  { href: '/admin/outreach',             label: 'Dashboard' },
  { href: '/admin/outreach/import',      label: 'Import' },
  { href: '/admin/outreach/templates',   label: 'Templates' },
  { href: '/admin/outreach/sends',       label: 'Sent Log' },
  { href: '/admin/outreach/suppression', label: 'Suppression' },
]

export default async function OutreachLayout({ children }: { children: React.ReactNode }) {
  const user = await getAdminUser()
  if (!user) redirect('/login?callbackUrl=/admin/outreach')

  const brian = isBrian(user)

  return (
    <div className="min-h-full bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 md:px-8">
        <div className="flex items-center gap-0.5 md:gap-1 py-2 overflow-x-auto">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider mr-2 md:mr-3 whitespace-nowrap">
            Outreach
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
          <span className="ml-auto flex-shrink-0">
            {brian ? (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 whitespace-nowrap">
                Sending enabled for you
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500 whitespace-nowrap">
                View only · sending restricted to Brian
              </span>
            )}
          </span>
        </div>
      </div>
      {children}
    </div>
  )
}
