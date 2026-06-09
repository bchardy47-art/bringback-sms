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
    <nav className="px-3 space-y-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon, key }) => {
        const active = pathname === href || pathname.startsWith(href + '/')
        const showBadge = key === 'inbox' && inboxCount > 0

        return (
          <a
            key={href}
            href={href}
            className="flex items-center gap-3 transition-all"
            style={
              active
                ? {
                    height: 46,
                    padding: '0 14px',
                    borderRadius: 8,
                    background: 'linear-gradient(90deg, rgba(255,27,27,0.32), rgba(255,27,27,0.08))',
                    border: '1px solid rgba(255,27,27,0.75)',
                    boxShadow:
                      '0 0 18px rgba(255,27,27,0.45), inset 3px 0 0 #ff1b1b',
                    color: 'white',
                    fontWeight: 800,
                    letterSpacing: '0.02em',
                    fontSize: 13,
                  }
                : {
                    height: 46,
                    padding: '0 14px',
                    borderRadius: 8,
                    border: '1px solid transparent',
                    color: 'rgba(255,255,255,0.55)',
                    fontWeight: 700,
                    fontSize: 13,
                    letterSpacing: '0.02em',
                  }
            }
          >
            <Icon
              size={17}
              strokeWidth={active ? 2.4 : 1.8}
              style={{ color: active ? '#ff5252' : 'inherit', flexShrink: 0 }}
            />
            <span className="flex-1">{label}</span>
            {showBadge && (
              <span
                className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1 rounded-full font-black"
                style={{
                  background: 'linear-gradient(180deg, #ff2929, #8b0909)',
                  color: 'white',
                  fontSize: 10,
                  boxShadow: '0 0 10px rgba(255,27,27,0.65)',
                  border: '1px solid rgba(255,80,80,0.65)',
                }}
              >
                {inboxCount > 99 ? '99+' : inboxCount}
              </span>
            )}
          </a>
        )
      })}
    </nav>
  )
}
