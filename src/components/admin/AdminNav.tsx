'use client'

/**
 * AdminNav — the single primary admin navigation Brian sees on every /admin
 * page. Six daily-driver destinations instead of the old 11-item DLR subnav.
 *
 * The advanced setup/operations routes (intakes, readiness, go-no-go,
 * pre-live, production, workflows, lead review, send pilot, handoffs, demo
 * requests, suppression…) are NOT deleted — they remain reachable from the
 * Setup Pipeline view (/admin/dlr) and System (health) page. This nav only
 * controls what's in front of Brian by default.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type AdminNavItem = {
  href: string
  label: string
  // pathname prefixes that should light this item up as active
  match: string[]
}

const ITEMS: AdminNavItem[] = [
  { href: '/admin',              label: 'Command Center', match: [] /* exact-only, handled below */ },
  { href: '/admin/dealers',      label: 'Dealers',        match: ['/admin/dealers', '/admin/dlr/dealers'] },
  { href: '/admin/dlr/pilot',    label: 'Campaigns',      match: ['/admin/dlr/pilot', '/admin/dlr/pilot-leads', '/admin/dlr/live-pilot', '/admin/dlr/first-pilot'] },
  { href: '/admin/outreach',     label: 'Outreach',       match: ['/admin/outreach'] },
  { href: '/admin/dlr/messages', label: 'Messages',       match: ['/admin/dlr/messages', '/admin/dlr/handoffs'] },
  { href: '/admin/dlr/health',   label: 'System',         match: ['/admin/dlr/health', '/admin/activity', '/admin/dlr/suppression', '/admin/dlr/workflows', '/admin/dlr/production', '/admin/dlr/readiness'] },
]

export function AdminNav() {
  const pathname = usePathname() ?? ''

  const isActive = (item: AdminNavItem): boolean => {
    if (item.href === '/admin') return pathname === '/admin'
    return item.match.some(p => pathname === p || pathname.startsWith(p + '/') || pathname === p)
  }

  return (
    <div className="bg-white border-b border-gray-200 px-4 md:px-8">
      <div className="max-w-7xl mx-auto flex items-center gap-0.5 md:gap-1 py-2 overflow-x-auto">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider mr-2 md:mr-3 whitespace-nowrap">
          DLR Admin
        </span>
        {ITEMS.map(item => {
          const active = isActive(item)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`px-2.5 md:px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                active
                  ? 'bg-red-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
