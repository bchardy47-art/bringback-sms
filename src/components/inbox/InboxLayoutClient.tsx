'use client'

import { usePathname } from 'next/navigation'

interface InboxLayoutClientProps {
  sidebar: React.ReactNode
  children: React.ReactNode
}

export function InboxLayoutClient({ sidebar, children }: InboxLayoutClientProps) {
  const pathname = usePathname()
  // Hide the list on mobile when we're inside a specific conversation.
  // (`children` is the conversation view; its own header carries a back link.)
  const isDetailRoute = /\/inbox\/[^/]+/.test(pathname)
  // Dealer surfaces get the dark command-center frame. Admin keeps the
  // existing light treatment.
  const isDealer = pathname.startsWith('/dealer')

  return (
    <div
      className={`flex h-full ${isDealer ? 'dlr-app-bg' : ''}`}
      style={{ height: '100%' }}
    >
      {/* Left: Conversation list */}
      <div
        className={`${
          isDetailRoute ? 'hidden md:flex' : 'flex'
        } w-full md:w-[330px] flex-shrink-0 flex-col overflow-hidden`}
        style={
          isDealer
            ? {
                background: 'rgba(3,3,4,0.92)',
                borderRight: '1px solid rgba(255,27,27,0.2)',
              }
            : {
                background: 'white',
                borderRight: '1px solid #f0f0f0',
              }
        }
      >
        {sidebar}
      </div>

      {/* Right: Conversation detail (hidden on mobile when showing list).
          On desktop the conversation page itself renders its own right
          lead-detail column inside `children`, so the inbox layout is a
          2-grid here (list + content) and the 3rd column lives inside
          the conversation view. */}
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
