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

// Dealer-theme variant: dark glass chips that read on the black panel.
const STATE_COLORS_DARK: Record<string, { bg: string; color: string; border: string }> = {
  active:    { bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', border: 'rgba(255,255,255,0.12)' },
  stale:     { bg: 'rgba(245,158,11,0.14)',  color: '#fbbf24',                border: 'rgba(245,158,11,0.4)'  },
  enrolled:  { bg: 'rgba(59,130,246,0.14)',  color: '#93c5fd',                border: 'rgba(59,130,246,0.4)'  },
  responded: { bg: 'rgba(34,197,94,0.14)',   color: '#4ade80',                border: 'rgba(34,197,94,0.4)'   },
  revived:   { bg: 'rgba(34,197,94,0.18)',   color: '#4ade80',                border: 'rgba(34,197,94,0.5)'   },
  exhausted: { bg: 'rgba(255,27,27,0.12)',   color: '#ff5252',                border: 'rgba(255,27,27,0.4)'   },
  opted_out: { bg: 'rgba(255,27,27,0.18)',   color: '#ff5252',                border: 'rgba(255,27,27,0.5)'   },
  dead:      { bg: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.35)', border: 'rgba(255,255,255,0.1)' },
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
    case 'needs_review':
      return convs.filter((c) => {
        if (c.status !== 'open') return false
        if (c.humanTookOverAt) return false
        const last = c.messages[0]
        return last?.direction === 'inbound'
      })
    case 'automated':
      return convs.filter((c) => {
        if (c.status !== 'open') return false
        if (c.humanTookOverAt) return false
        const last = c.messages[0]
        return !last || last.direction === 'outbound'
      })
    case 'human_owned':
      return convs.filter((c) => !!c.humanTookOverAt)
    case 'opted_out':
      return convs.filter((c) => c.status === 'opted_out')
    case 'closed':
      return convs.filter((c) => c.status === 'closed')
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

const DEALER_TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'needs_review', label: 'Needs Review' },
  { key: 'automated',    label: 'Auto replies' },
  { key: 'human_owned',  label: 'Handled by you' },
  { key: 'opted_out',    label: 'Opted Out' },
  { key: 'closed',       label: 'Closed' },
]

const ADMIN_TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'open',           label: 'All' },
  { key: 'awaiting_reply', label: 'Awaiting Reply' },
  { key: 'replied',        label: 'Replied' },
  { key: 'opted_out',      label: 'Opted Out' },
]

// ── Component ───────────────────────────────────────────────────────────────

export function ConversationListSidebar({
  conversations,
  basePath = '/inbox',
  title = 'Inbox',
}: {
  conversations: Conversation[]
  /** Accepted for backwards-compat with admin callers; not used. */
  totalOpen?: number
  basePath?: string
  title?: string
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const isDealer = basePath.startsWith('/dealer')
  const TABS = isDealer ? DEALER_TABS : ADMIN_TABS
  const defaultTab = isDealer
    ? (applyTabFilter(conversations, 'needs_review').length === 0
        && applyTabFilter(conversations, 'automated').length > 0
        ? 'automated'
        : 'needs_review')
    : 'open'

  const [activeTab, setActiveTab] = useState<string>(
    () => searchParams.get('tab') ?? searchParams.get('status') ?? defaultTab,
  )
  const [search, setSearch] = useState('')

  const handleTabClick = useCallback((key: string) => {
    setActiveTab(key)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', key)
      url.searchParams.delete('status')
      window.history.replaceState(window.history.state, '', url.toString())
    }
  }, [])

  const counts = Object.fromEntries(
    TABS.map((t) => [t.key, applyTabFilter(conversations, t.key).length])
  )

  const needsReviewCount = isDealer
    ? applyTabFilter(conversations, 'needs_review').length
    : applyTabFilter(conversations, 'open').length

  const tabFiltered = applyTabFilter(conversations, activeTab)
  const displayed = tabFiltered.filter((c) => {
    const q = search.toLowerCase()
    if (!q) return true
    const name = `${c.lead.firstName} ${c.lead.lastName}`.toLowerCase()
    return name.includes(q) || c.lead.phone.includes(q)
  })

  if (isDealer) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div
          className="px-4 pt-5 pb-3 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="eyebrow red">Inbox</p>
              <h1 className="text-base font-black text-white mt-0.5 leading-tight uppercase tracking-wide">{title}</h1>
            </div>
            {needsReviewCount > 0 && (
              <span
                className="text-xs font-black text-white rounded-full px-2 py-0.5"
                style={{
                  background: 'linear-gradient(180deg, #ff2929, #8b0909)',
                  boxShadow: '0 0 12px rgba(255,27,27,0.55)',
                  border: '1px solid rgba(255,80,80,0.6)',
                }}
              >
                {needsReviewCount}
              </span>
            )}
          </div>
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.4)' }} />
            <input
              type="text"
              placeholder="Search conversations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-xs rounded-lg outline-none transition-colors"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'white',
              }}
            />
          </div>
        </div>

        {/* Filter tabs */}
        <div
          className="px-3 py-2 flex gap-1 flex-wrap flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key
            const count = counts[tab.key] ?? 0
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleTabClick(tab.key)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider transition-colors whitespace-nowrap"
                style={
                  isActive
                    ? {
                        background: 'rgba(255,27,27,0.20)',
                        border: '1px solid rgba(255,27,27,0.7)',
                        boxShadow: '0 0 18px rgba(255,27,27,0.32)',
                        color: '#fff',
                      }
                    : {
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: 'rgba(255,255,255,0.55)',
                      }
                }
              >
                {tab.label}
                {count > 0 && (
                  <span
                    className="text-[9px] font-black rounded-full px-1.5 leading-[16px]"
                    style={{
                      background: isActive ? 'rgba(255,80,80,0.4)' : 'rgba(255,255,255,0.08)',
                      color: isActive ? '#fff' : 'rgba(255,255,255,0.6)',
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto dlr-scrollbar">
          {displayed.length === 0 ? (
            <DealerEmptyTabState
              activeTab={activeTab}
              counts={counts}
            />
          ) : (
            displayed.map((conv) => {
              const convPath = `${basePath}/${conv.id}`
              const isSelected = pathname === convPath
              const lastMsg = conv.messages[0]
              const stateDark = STATE_COLORS_DARK[conv.lead.state] ?? STATE_COLORS_DARK.active
              const initials = `${conv.lead.firstName[0] ?? ''}${conv.lead.lastName?.[0] ?? ''}`.toUpperCase()
              const isInbound = lastMsg?.direction === 'inbound'
              const isHumanOwned = !!conv.humanTookOverAt
              const needsReview = !isHumanOwned && isInbound && conv.status === 'open'

              return (
                <Link
                  key={conv.id}
                  href={convPath}
                  className="flex gap-3 px-4 py-3.5 transition-colors"
                  style={
                    isSelected
                      ? {
                          background: 'linear-gradient(90deg, rgba(255,27,27,0.28), rgba(255,27,27,0.08))',
                          borderBottom: '1px solid rgba(255,27,27,0.4)',
                          borderLeft: '3px solid #ff1b1b',
                          boxShadow: '0 0 28px rgba(255,27,27,0.4)',
                        }
                      : {
                          background: needsReview
                            ? 'rgba(255,27,27,0.06)'
                            : 'transparent',
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                          borderLeft: needsReview
                            ? '3px solid rgba(255,27,27,0.5)'
                            : '3px solid transparent',
                        }
                  }
                >
                  {/* Avatar */}
                  <div className="relative flex-shrink-0 mt-0.5">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-black"
                      style={{
                        background: 'linear-gradient(135deg, #1a0505, #3a0505)',
                        border: '1px solid rgba(255,27,27,0.45)',
                        boxShadow: needsReview ? '0 0 10px rgba(255,27,27,0.4)' : 'none',
                      }}
                    >
                      {initials || 'L'}
                    </div>
                    {needsReview && (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full"
                        style={{
                          background: '#ff1b1b',
                          border: '2px solid rgba(3,3,4,1)',
                          boxShadow: '0 0 8px rgba(255,27,27,0.8)',
                        }}
                      />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span
                        className="text-sm font-bold truncate"
                        style={{ color: isSelected ? '#fff' : 'rgba(255,255,255,0.92)' }}
                      >
                        {conv.lead.firstName} {conv.lead.lastName}
                      </span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {needsReview && (
                          <span
                            className="text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-widest"
                            style={{
                              background: 'rgba(255,27,27,0.18)',
                              color: '#ff5252',
                              border: '1px solid rgba(255,27,27,0.5)',
                            }}
                          >
                            Review
                          </span>
                        )}
                        {isHumanOwned && (
                          <span
                            className="text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-widest"
                            style={{
                              background: 'rgba(34,197,94,0.14)',
                              color: '#4ade80',
                              border: '1px solid rgba(34,197,94,0.45)',
                            }}
                          >
                            You
                          </span>
                        )}
                        <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{timeAgo(conv.updatedAt)}</span>
                      </div>
                    </div>
                    {lastMsg ? (
                      <p
                        className="text-xs truncate"
                        style={{
                          color: isInbound && !isHumanOwned
                            ? 'rgba(255,255,255,0.85)'
                            : 'rgba(255,255,255,0.5)',
                          fontWeight: isInbound && !isHumanOwned ? 600 : 400,
                        }}
                      >
                        {lastMsg.direction === 'outbound'
                          ? 'Automation: '
                          : conv.lead.firstName
                            ? `${conv.lead.firstName}: `
                            : ''}
                        {lastMsg.body}
                      </p>
                    ) : (
                      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>No messages</p>
                    )}
                    <span
                      className="mt-1 inline-block text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-widest"
                      style={{
                        background: stateDark.bg,
                        color: stateDark.color,
                        border: `1px solid ${stateDark.border}`,
                      }}
                    >
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

  // ── Admin (light) variant — unchanged ─────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-base font-bold text-gray-900">{title}</h1>
          {needsReviewCount > 0 && (
            <span className="text-xs font-bold text-white bg-red-500 rounded-full px-2 py-0.5">
              {needsReviewCount}
            </span>
          )}
        </div>
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

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {displayed.length === 0 ? (
          <EmptyTabState
            activeTab={activeTab}
            counts={counts}
            isDealer={isDealer}
          />
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
                      {lastMsg.direction === 'outbound'
                        ? 'Automation: '
                        : conv.lead.firstName
                          ? `${conv.lead.firstName}: `
                          : ''}
                      {lastMsg.body}
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

// ── Tab-aware empty state (light theme — admin) ─────────────────────────────
function EmptyTabState({
  activeTab,
  counts,
  isDealer,
}: {
  activeTab: string
  counts:    Record<string, number>
  isDealer:  boolean
}) {
  const otherTabsTotal =
    Object.entries(counts)
      .filter(([key]) => key !== activeTab)
      .reduce((sum, [, n]) => sum + n, 0)

  let title: string
  let detail: string

  if (isDealer && activeTab === 'needs_review') {
    title = 'No conversations need review right now.'
    detail = otherTabsTotal > 0
      ? 'Automated and taken-over conversations are in the other tabs.'
      : 'When customers reply to your campaign messages, their conversations will appear here for your team to review.'
  } else if (isDealer && activeTab === 'automated') {
    title = 'No automated conversations right now.'
    detail = otherTabsTotal > 0
      ? 'Replies needing review or already taken over are in the other tabs.'
      : 'Threads DLR is running on autopilot will appear here.'
  } else if (isDealer && activeTab === 'human_owned') {
    title = "No conversations you've taken over."
    detail = otherTabsTotal > 0
      ? 'Automated and needs-review conversations are in the other tabs.'
      : 'Conversations you take over will move here.'
  } else if (activeTab === 'opted_out') {
    title = 'No opted-out conversations.'
    detail = 'Leads who reply STOP will appear here for your records.'
  } else if (activeTab === 'closed') {
    title = 'No closed conversations.'
    detail = 'Resolved threads will be archived here.'
  } else {
    title = 'No conversations in this tab.'
    detail = otherTabsTotal > 0
      ? 'Other tabs have conversations.'
      : 'Customer conversations will appear here.'
  }

  return (
    <div className="px-4 py-8 text-center">
      <p className="text-sm font-medium text-gray-700">{title}</p>
      <p className="text-xs text-gray-400 mt-1">{detail}</p>
    </div>
  )
}

// ── Dealer-theme empty state ────────────────────────────────────────────────
function DealerEmptyTabState({
  activeTab,
  counts,
}: {
  activeTab: string
  counts:    Record<string, number>
}) {
  const otherTabsTotal =
    Object.entries(counts)
      .filter(([key]) => key !== activeTab)
      .reduce((sum, [, n]) => sum + n, 0)

  let title: string
  let detail: string

  if (activeTab === 'needs_review') {
    title = 'No conversations need review right now.'
    detail = otherTabsTotal > 0
      ? 'Auto-reply and handled conversations are in the other tabs.'
      : 'Customer replies will appear here when leads start responding.'
  } else if (activeTab === 'automated') {
    title = 'No auto-reply conversations right now.'
    detail = otherTabsTotal > 0
      ? 'Replies needing review or already handled are in the other tabs.'
      : 'Threads DLR is running on autopilot will appear here.'
  } else if (activeTab === 'human_owned') {
    title = 'No conversations handled by you yet.'
    detail = otherTabsTotal > 0
      ? 'Auto-reply and review-needed conversations are in the other tabs.'
      : 'Conversations you take over will move here.'
  } else if (activeTab === 'opted_out') {
    title = 'No opted-out conversations.'
    detail = 'Leads who reply STOP will appear here for your records.'
  } else if (activeTab === 'closed') {
    title = 'No closed conversations.'
    detail = 'Resolved threads will be archived here.'
  } else {
    title = 'No conversations in this tab.'
    detail = otherTabsTotal > 0
      ? 'Other tabs have conversations.'
      : 'Customer conversations will appear here.'
  }

  return (
    <div className="px-5 py-10 text-center">
      <p className="text-sm font-bold text-white">{title}</p>
      <p className="text-xs mt-1 leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>{detail}</p>
    </div>
  )
}
