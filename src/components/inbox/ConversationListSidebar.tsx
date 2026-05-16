'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { useCallback, useState } from 'react'

type Conversation = {
  id: string
  status: string
  updatedAt: Date | string
  humanTookOverAt?: Date | string | null
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

// ── Tab filter logic ────────────────────────────────────────────────────────

type TabKey = 'needs_review' | 'automated' | 'human_owned' | 'opted_out' | 'closed'
  | 'open' | 'awaiting_reply' | 'replied'

function applyTabFilter(convs: Conversation[], tabKey: string): Conversation[] {
  switch (tabKey) {
    // ── Dealer tabs ────────────────────────────────────────────────────────
    case 'needs_review':
      // Open + last message was inbound (lead replied) + NOT yet taken over
      return convs.filter((c) => {
        if (c.status !== 'open') return false
        if (c.humanTookOverAt) return false
        const last = c.messages[0]
        return last?.direction === 'inbound'
      })
    case 'automated':
      // Open + last message was outbound (automation sent) + NOT taken over
      return convs.filter((c) => {
        if (c.status !== 'open') return false
        if (c.humanTookOverAt) return false
        const last = c.messages[0]
        return !last || last.direction === 'outbound'
      })
    case 'human_owned':
      // Taken over by a human
      return convs.filter((c) => !!c.humanTookOverAt)
    case 'opted_out':
      return convs.filter((c) => c.status === 'opted_out')
    case 'closed':
      return convs.filter((c) => c.status === 'closed')

    // ── Admin/legacy tabs ──────────────────────────────────────────────────
    case 'open':
      return convs.filter((c) => c.status === 'open')
    case 'awaiting_reply':
      return convs.filter((c) => {
        if (c.status !== 'open') return false
        const last = c.messages[0]
        return !last || last.direction === 'outbound'
      })
    case 'replied':
      return convs.filter((c) => {
        if (c.status !== 'open') return false
        return c.messages[0]?.direction === 'inbound'
      })
    default:
      return convs
  }
}

// ── Dealer tab set ──────────────────────────────────────────────────────────

const DEALER_TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'needs_review', label: 'Needs Review' },
  { key: 'automated',    label: 'Automated' },
  { key: 'human_owned',  label: 'Human-Owned' },
  { key: 'opted_out',    label: 'Opted Out' },
  { key: 'closed',       label: 'Closed' },
]

// ── Admin tab set ───────────────────────────────────────────────────────────

const ADMIN_TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'open',           label: 'All' },
  { key: 'awaiting_reply', label: 'Awaiting Reply' },
  { key: 'replied',        label: 'Replied' },
  { key: 'opted_out',      label: 'Opted Out' },
]

// ── Component ───────────────────────────────────────────────────────────────

export function ConversationListSidebar({
  conversations,
  totalOpen: _totalOpen,
  basePath = '/inbox',
}: {
  conversations: Conversation[]
  totalOpen: number
  /** Base URL for tab links and conversation links. Default: /inbox */
  basePath?: string
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const isDealer = basePath.startsWith('/dealer')
  const TABS = isDealer ? DEALER_TABS : ADMIN_TABS
  const defaultTab = isDealer ? 'needs_review' : 'open'

  // Tab state is owned client-side after first render. The URL ?status= is
  // read once for the initial value (so deep links / shared URLs work) and
  // then kept in sync via history.replaceState. We deliberately avoid
  // next/link, router.push, and router.replace for tab switches so that
  // clicking a tab never triggers an _rsc soft-navigation fetch.
  const [activeTab, setActiveTab] = useState<string>(
    () => searchParams.get('status') ?? defaultTab,
  )
  const [search, setSearch] = useState('')

  const handleTabClick = useCallback((key: string) => {
    setActiveTab(key)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('status', key)
      window.history.replaceState(window.history.state, '', url.toString())
    }
  }, [])

  // Compute per-tab counts
  const counts = Object.fromEntries(
    TABS.map((t) => [t.key, applyTabFilter(conversations, t.key).length])
  )

  // Needs-review badge for header (dealer only)
  const needsReviewCount = isDealer
    ? applyTabFilter(conversations, 'needs_review').length
    : applyTabFilter(conversations, 'open').length

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
          {needsReviewCount > 0 && (
            <span className="text-xs font-bold text-white bg-red-500 rounded-full px-2 py-0.5">
              {needsReviewCount}
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

      {/* Filter tabs — pure client-side filter over the already-loaded
          conversation list. Buttons, not Links, so clicks never trigger
          an _rsc fetch. */}
      <div className="px-3 py-2 border-b border-gray-100 flex gap-1 flex-wrap flex-shrink-0">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key
          const count = counts[tab.key] ?? 0
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleTabClick(tab.key)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span
                  className={`text-[10px] font-bold rounded-full px-1.5 leading-[18px] ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
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
            const convPath = `${basePath}/${conv.id}`
            const isSelected = pathname === convPath
            const lastMsg = conv.messages[0]
            const badge = STATE_COLORS[conv.lead.state] ?? 'bg-gray-100 text-gray-600'
            const initials = `${conv.lead.firstName[0] ?? ''}${conv.lead.lastName?.[0] ?? ''}`.toUpperCase()
            const avatarColor = nameToColor(conv.lead.firstName)
            const isInbound = lastMsg?.direction === 'inbound'
            const isHumanOwned = !!conv.humanTookOverAt
            const needsReview = !isHumanOwned && isInbound && conv.status === 'open'

            return (
              <Link
                key={conv.id}
                href={convPath}
                className={`flex gap-3 px-4 py-3.5 border-b border-gray-50 transition-colors ${
                  isSelected
                    ? 'bg-red-50 border-l-2 border-l-red-500'
                    : needsReview
                    ? 'bg-amber-50 hover:bg-amber-100 border-l-2 border-l-amber-400'
                    : isHumanOwned
                    ? 'bg-green-50 hover:bg-green-100 border-l-2 border-l-green-400'
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
                  {isInbound && !isHumanOwned && (
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
                      {needsReview && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                          REVIEW
                        </span>
                      )}
                      {isHumanOwned && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }}>
                          YOU
                        </span>
                      )}
                      <span className="text-xs text-gray-400">{timeAgo(conv.updatedAt)}</span>
                    </div>
                  </div>
                  {lastMsg ? (
                    <p className={`text-xs truncate ${isInbound && !isHumanOwned ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>
                      {lastMsg.direction === 'outbound' ? 'DLR: ' : ''}{lastMsg.body}
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
