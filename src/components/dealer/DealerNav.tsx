'use client'

import { usePathname } from 'next/navigation'
import { LayoutDashboard, Upload, ClipboardList, MessageSquare } from 'lucide-react'

const NAV_ITEMS = [
  { href: '/dealer/dashboard', label: 'Dashboard',    icon: LayoutDashboard, key: 'dashboard' as const },
  { href: '/dealer/import',    label: 'Upload Leads', icon: Upload,          key: 'import' as const },
  { href: '/dealer/batches',   label: 'Campaigns',    icon: ClipboardList,   key: 'batches' as const },
  { href: '/dealer/inbox',     label: 'Inbox',        icon: MessageSquare,   key: 'inbox' as const },
]

export function DealerNav({ inboxCount = 0 }: { inboxCount?: number }) {
  const pathname = usePathname()

  return (
    <>
      {NAV_ITEMS.map(({ href, label, icon: Icon, key }) => {
        const active = pathname === href || pathname.startsWith(href + '/')
        const showBadge = key === 'inbox' && inboxCount > 0

        return (
          <a
            key={href}
            href={href}
            className={`nav-item${active ? ' active' : ''}`}
          >
            <Icon size={19} strokeWidth={active ? 2.2 : 1.8} />
            <span style={{ flex: 1 }}>{label}</span>
            {showBadge && (
              <span className="nav-badge">
                {inboxCount > 99 ? '99+' : inboxCount}
              </span>
            )}
          </a>
        )
      })}
    </>
  )
}
