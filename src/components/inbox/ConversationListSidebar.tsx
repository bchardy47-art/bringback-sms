'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { useState } from 'react'

type Conversation = {
  id: string
  status: string
  updatedAt: Date | string
  lead: {
    id: string
    firstName: string
    lastName: string
    phone: string
    state: string
  }
  messages: Array<{
    direction: string
    body: string
    createdAt: Date | string
  }>
}

const STATE_COLORS: Record<string, string> = {
  active:    'bg-gray-100 text-gray-600',
  stale:     'bg-yellow-100 text-yellow-700',
  enrolled:  'bg-blue-100 text-blue-700',
  responded: 'bg-green-100 text-green-700',
  revived:   'bg-emerald-100 text-emerald-700',
  exhausted: 'bg-red-100 text-red-600',
  opted_out: 'bg-red-100 text-red-700',
  dead:      'bg-gray-100 text-gray-400',
}

const AVATAR_COLORS = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#be185d']
function nameToColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function timeAgo(date: Date | string): string {
  const d = new Date(date)
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

/** Apply the tab key filter to a conversation list */
function applyTabFilter(convs: Conversation[], tabKey: string): Conversation[] {
  switch (tabKey) {
    case 'open':
      // All active conversations (not opted out or closed)
      return convs.filter((c) => c.status === 'open')
    case 'awaiting_reply':
      // Open + last message was outbound (we sent last, waiting on lead)
      return convs.filter((c) => {
        if (c.status !== 'open') return false
        const last = c.messages[0]
        return !last || last.direction === 'outbound'
      })
    case 'replied':
      // Open + last message was inbound (lead replied)
      return convs.filter((c) => {
        if (c.status !== 'open') return false
        const last = c.messages[0]
        return last?.direction === 'inbound'
      })
    case 'opted_out':
      return convs.filter((c) => c.status === 'opted_out')
    default:
      return convs
  }
}

export function ConversationListSidebar({
  conversations,
}: {
  conversations: Conversation[]
  totalOpen: number
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeTab = searchParams.get('status') ?? 'open'
  const [search, setSearch] = useState('')

  // Compute per-tab counts up front
  const counts = {
    open:           applyTabFilter(conversations, 'open').length,
    awaiting_reply: applyTabFilter(conversations, 'awaiting_reply').length,
    replied:        applyTabFilter(conversations, 'replied').length,
    opted_out:      applyTabFilter(conversations, 'opted_out').length,
  }

  const TABS = [
    { key: 'open',           label: 'All',            count: counts.open },
    { key: 'awaiting_reply', label: 'Awaiting Reply',  count: counts.awaiting_reply },
    { key: 'replied',        label: 'Replied',         count: counts.replied },
    { key: 'opted_out',      label: 'Opted Out',       count: counts.opted_out },
  ]

  // Apply tab filter then search filter
  const tabFiltered = applyTabFilter(conversations, activeTab)
  const displayed = tabFiltered.filter((c) => {
    const q = search.toLowerCase()
    if (!q) return true
    const name = `${c.lead.firstName} ${c.lead.lastName}`.toLowerCase()
    return name.includes(q) || c.lead.phone.includes(q)
  })

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-base font-bold text-gray-900">Inbox</h1>
          {counts.open > 0 && (
            <span className="text-xs font-bold text-white bg-red-500 rounded-full px-2 py-0.5">
              {counts.open}
            </span>
          )}
        </div>
        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-gray-300 focus:bg-white transition-colors"
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="px-3 py-2 border-b border-gray-100 flex gap-1 flex-wrap flex-shrink-0">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key
          return (
            <Link
              key={tab.key}
              href={`/inbox?status=${tab.key}`}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span
                  className={`text-[10px] font-bold rounded-full px-1.5 leading-[18px] ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </Link>
          )
        })}
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {displayed.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-gray-400">No conversations</p>
          </div>
        ) : (
          displayed.map((conv) => {
            const isSelected = pathname === `/inbox/${conv.id}`
            const lastMsg = conv.messages[0]
            const badge = STATE_COLORS[conv.lead.state] ?? 'bg-gray-100 text-gray-600'
            const initials = `${conv.lead.firstName[0] ?? ''}${conv.lead.lastName?.[0] ?? ''}`.toUpperCase()
            const avatarColor = nameToColor(conv.lead.firstName)
            const isInbound = lastMsg?.direction === 'inbound'

            const isReviving = conv.lead.state === 'responded'

            return (
              <Link
                key={conv.id}
                href={`/inbox/${conv.id}`}
                className={`flex gap-3 px-4 py-3.5 border-b border-gray-50 transition-colors ${
                  isSelected
                    ? 'bg-red-50 border-l-2 border-l-red-500'
                    : isReviving
                    ? 'bg-amber-50 hover:bg-amber-100 border-l-2 border-l-amber-400'
                    : 'hover:bg-gray-50'
                }`}
              >
                {/* Avatar with inbound dot */}
                <div className="relative flex-shrink-0 mt-0.5">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: avatarColor }}
                  >
                    {initials}
                  </div>
                  {isInbound && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className={`text-sm font-semibold truncate ${isSelected ? 'text-red-700' : 'text-gray-900'}`}>
                      {conv.lead.firstName} {conv.lead.lastName}
                    </span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isReviving && (
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                          REVIVING
                        </span>
                      )}
                      <span className="text-xs text-gray-400">{timeAgo(conv.updatedAt)}</span>
                    </div>
                  </div>
                  {lastMsg ? (
                    <p className={`text-xs truncate ${isInbound ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>
                      {lastMsg.direction === 'outbound' ? 'You: ' : ''}{lastMsg.body}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400">No messages</p>
                  )}
                  <span className={`mt-1 inline-block text-xs px-1.5 py-0.5 rounded font-medium ${badge}`}>
                    {conv.lead.state.replace('_', ' ')}
                  </span>
                </div>
              </Link>
            )
          })
        )}
      </div>
    </div>
  )
}
