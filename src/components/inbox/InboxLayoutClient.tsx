'use client'

import { usePathname } from 'next/navigation'

interface InboxLayoutClientProps {
  sidebar: React.ReactNode
  children: React.ReactNode
}

export function InboxLayoutClient({ sidebar, children }: InboxLayoutClientProps) {
  const pathname = usePathname()
  // Hide the list on mobile when we're inside a specific conversation
  const isDetailRoute = /\/inbox\/[^/]+/.test(pathname)

  return (
    <div className="flex h-full" style={{ height: '100%' }}>
      {/* Left: Conversation list */}
      <div
        className={`${
          isDetailRoute ? 'hidden md:flex' : 'flex'
        } w-full md:w-80 flex-shrink-0 bg-white flex-col overflow-hidden`}
        style={{ borderRight: '1px solid #f0f0f0' }}
      >
        {sidebar}
      </div>

      {/* Right: Conversation detail (hidden on mobile when showing list) */}
      <div
        className={`${
          isDetailRoute ? 'flex' : 'hidden md:flex'
        } flex-1 overflow-hidden flex-col`}
      >
        {children}
      </div>
    </div>
  )
}
