'use client'

import { usePathname } from 'next/navigation'
import { LayoutDashboard, Upload, ClipboardList, MessageSquare } from 'lucide-react'

const NAV_ITEMS = [
  { href: '/dealer/dashboard', label: 'Dashboard',    icon: LayoutDashboard, key: 'dashboard' },
  { href: '/dealer/import',    label: 'Upload Leads', icon: Upload,          key: 'import' },
  { href: '/dealer/batches',   label: 'Campaigns',    icon: ClipboardList,   key: 'batches' },
  { href: '/dealer/inbox',     label: 'Inbox',        icon: MessageSquare,   key: 'inbox' },
]

export function DealerMobileNav({ inboxCount = 0 }: { inboxCount?: number }) {
  const pathname = usePathname()

  return (
    <nav
      className="flex md:hidden gap-1 overflow-x-auto px-3 py-2"
      style={{
        background: 'rgba(3,3,4,0.92)',
        borderBottom: '1px solid rgba(255,27,27,0.28)',
      }}
    >
      {NAV_ITEMS.map(({ href, label, icon: Icon, key }) => {
        const active = pathname === href || pathname.startsWith(href + '/')
        const showBadge = key === 'inbox' && inboxCount > 0

        return (
          <a
            key={href}
            href={href}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors relative"
            style={
              active
                ? {
                    background: 'linear-gradient(90deg, rgba(255,27,27,0.32), rgba(255,27,27,0.08))',
                    border: '1px solid rgba(255,27,27,0.7)',
                    color: 'white',
                    boxShadow: '0 0 12px rgba(255,27,27,0.4)',
                  }
                : {
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'rgba(255,255,255,0.6)',
                  }
            }
          >
            <Icon size={13} style={{ color: active ? '#ff5252' : 'inherit' }} />
            {label}
            {showBadge && (
              <span
                className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full font-black ml-0.5"
                style={{
                  background: 'linear-gradient(180deg, #ff2929, #8b0909)',
                  color: 'white',
                  fontSize: 9,
                  boxShadow: '0 0 8px rgba(255,27,27,0.6)',
                }}
              >
                {inboxCount > 9 ? '9+' : inboxCount}
              </span>
            )}
          </a>
        )
      })}
    </nav>
  )
}
