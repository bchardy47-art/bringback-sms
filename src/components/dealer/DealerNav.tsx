'use client'

import { usePathname } from 'next/navigation'
import { LayoutDashboard, Upload, ClipboardList, MessageSquare } from 'lucide-react'

const NAV_ITEMS = [
  { href: '/dealer/dashboard', label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/dealer/import',    label: 'Upload Leads', icon: Upload },
  { href: '/dealer/batches',   label: 'Campaigns',    icon: ClipboardList },
  { href: '/dealer/inbox',     label: 'Inbox',        icon: MessageSquare },
]

export function DealerNav() {
  const pathname = usePathname()

  return (
    <nav className="px-3 space-y-0.5">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + '/')
        return (
          <a
            key={href}
            href={href}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
            style={
              active
                ? {
                    backgroundColor: 'rgba(220,38,38,0.13)',
                    color: '#ffffff',
                    boxShadow: 'inset 3px 0 0 #dc2626',
                  }
                : {
                    color: 'rgba(255,255,255,0.48)',
                  }
            }
          >
            <Icon
              size={16}
              strokeWidth={active ? 2.2 : 1.8}
              style={{ color: active ? '#f87171' : 'inherit', flexShrink: 0 }}
            />
            {label}
          </a>
        )
      })}
    </nav>
  )
}
