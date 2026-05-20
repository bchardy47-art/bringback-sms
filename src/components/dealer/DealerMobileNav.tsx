'use client'

import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/dealer/dashboard', label: 'Dashboard' },
  { href: '/dealer/import',    label: 'Upload Leads' },
  { href: '/dealer/batches',   label: 'Campaigns' },
  { href: '/dealer/inbox',     label: 'Inbox' },
]

export function DealerMobileNav() {
  const pathname = usePathname()

  return (
    <nav
      className="flex md:hidden gap-1 overflow-x-auto px-3 py-2 bg-white"
      style={{ borderBottom: '1px solid #e5e7eb' }}
    >
      {NAV_ITEMS.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(href + '/')
        return (
          <a
            key={href}
            href={href}
            className="flex-shrink-0 px-3.5 py-1.5 text-xs font-semibold rounded-full transition-colors"
            style={
              active
                ? { backgroundColor: '#111827', color: '#ffffff' }
                : { color: '#6b7280' }
            }
          >
            {label}
          </a>
        )
      })}
    </nav>
  )
}
