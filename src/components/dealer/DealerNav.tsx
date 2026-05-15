'use client'

import { usePathname } from 'next/navigation'
import { LayoutDashboard, Upload, ClipboardList, MessageSquare } from 'lucide-react'

const NAV_ITEMS = [
  { href: '/dealer/dashboard', label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/dealer/import',    label: 'Import Leads', icon: Upload },
  { href: '/dealer/batches',   label: 'Batches',      icon: ClipboardList },
  { href: '/dealer/inbox',     label: 'Inbox',        icon: MessageSquare },
]

export function DealerNav() {
  const pathname = usePathname()

  return (
    <nav className="px-2 space-y-0.5">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + '/')
        return (
          <a
            key={href}
            href={href}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors"
            style={
              active
                ? { backgroundColor: 'rgba(255,255,255,0.10)', color: '#ffffff' }
                : { color: 'rgba(255,255,255,0.55)' }
            }
          >
            <Icon size={16} strokeWidth={active ? 2.2 : 1.8} />
            {label}
          </a>
        )
      })}
    </nav>
  )
}
