'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Zap,
  BarChart3,
  Settings,
  Shield,
  type LucideIcon,
} from 'lucide-react'

type NavItem = { href: string; label: string; icon: LucideIcon }

const TEAM_NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/leads', label: 'Leads', icon: Users },
  { href: '/inbox', label: 'Inbox', icon: MessageSquare },
  { href: '/workflows', label: 'Workflows', icon: Zap },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
]

const ADMIN_NAV_ITEM: NavItem = { href: '/admin', label: 'Command Center', icon: Shield }

interface SidebarNavProps {
  inboxCount?: number
  role?: string
}

export function SidebarNav({ inboxCount = 0, role }: SidebarNavProps) {
  const pathname = usePathname()
  // Admins land on the Command Center (/admin). The dealer-style team items
  // (Leads, Inbox, Workflows, Reports, Settings) point at the admin's own
  // sandbox tenant and are noise for Brian's cross-tenant admin workflow, so
  // the admin sidebar shows only the Command Center entry. Day-to-day admin
  // navigation lives in the top admin nav (Dealers / Campaigns / Outreach /
  // Messages / System). Managers and agents keep the full team nav.
  const items: NavItem[] =
    role === 'admin' ? [ADMIN_NAV_ITEM] : TEAM_NAV_ITEMS

  return (
    <nav className="px-3 py-5 space-y-0.5">
      {items.map(({ href, label, icon: Icon }) => {
        const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href + '/'))
        const hasBadge = href === '/inbox' && inboxCount > 0

        return (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all"
            style={
              isActive
                ? { backgroundColor: '#dc2626', color: '#ffffff' }
                : { color: 'rgba(255,255,255,0.5)' }
            }
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.07)'
                e.currentTarget.style.color = 'rgba(255,255,255,0.9)'
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.color = 'rgba(255,255,255,0.5)'
              }
            }}
          >
            <Icon size={17} strokeWidth={isActive ? 2.2 : 1.8} />
            <span className="flex-1">{label}</span>
            {hasBadge && (
              <span
                className="text-xs font-bold rounded-full px-1.5 py-0.5 leading-none min-w-[20px] text-center"
                style={{
                  backgroundColor: isActive ? 'rgba(255,255,255,0.25)' : '#dc2626',
                  color: 'white',
                }}
              >
                {inboxCount > 99 ? '99+' : inboxCount}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
