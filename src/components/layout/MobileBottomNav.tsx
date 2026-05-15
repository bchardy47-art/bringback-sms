'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Zap,
  BarChart3,
} from 'lucide-react'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { href: '/leads', label: 'Leads', icon: Users },
  { href: '/inbox', label: 'Inbox', icon: MessageSquare },
  { href: '/workflows', label: 'Flows', icon: Zap },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
]

interface MobileBottomNavProps {
  inboxCount?: number
}

export function MobileBottomNav({ inboxCount = 0 }: MobileBottomNavProps) {
  const pathname = usePathname()

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden"
      style={{
        backgroundColor: '#ffffff',
        borderTop: '1px solid #e5e7eb',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const isActive =
          pathname === href || (href !== '/dashboard' && pathname.startsWith(href + '/'))
        const hasBadge = href === '/inbox' && inboxCount > 0

        return (
          <Link
            key={href}
            href={href}
            className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5"
            style={{ color: isActive ? '#dc2626' : '#9ca3af' }}
          >
            <div className="relative">
              <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
              {hasBadge && (
                <span
                  className="absolute -top-1 -right-2 w-4 h-4 rounded-full text-white flex items-center justify-center font-bold"
                  style={{ backgroundColor: '#dc2626', fontSize: 9 }}
                >
                  {inboxCount > 9 ? '9+' : inboxCount}
                </span>
              )}
            </div>
            <span style={{ fontSize: 10, fontWeight: isActive ? 600 : 500 }}>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
