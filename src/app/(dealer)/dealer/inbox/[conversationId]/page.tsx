import { redirect, notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import Link from 'next/link'
import { getDealerSession } from '@/lib/dealer/dev-auth-bypass'
import { db } from '@/lib/db'
import { conversations } from '@/lib/db/schema'
import { MessageThread } from '@/components/inbox/MessageThread'
import { ReplyBox } from '@/components/inbox/ReplyBox'
import { TakeOverBanner } from '@/components/inbox/TakeOverBanner'
import {
  Phone,
  Car,
  Calendar,
  User,
  MessageSquare,
  ArrowLeft,
  Zap,
  CheckCircle2,
  Ban,
  Tag,
  AlertTriangle,
} from 'lucide-react'

const STATE_BADGE: Record<string, { label: string; className: string }> = {
  active:    { label: 'Active',    className: 'dlr-badge-preview' },
  stale:     { label: 'Stale',     className: 'dlr-badge-approved' },
  enrolled:  { label: 'Enrolled',  className: 'dlr-badge-live' },
  responded: { label: 'Responded', className: 'dlr-badge-sending' },
  revived:   { label: 'Revived',   className: 'dlr-badge-sending' },
  exhausted: { label: 'Exhausted', className: 'dlr-badge-live' },
  opted_out: { label: 'Opted Out', className: 'dlr-badge-live' },
  dead:      { label: 'Dead',      className: 'dlr-badge-preview' },
}

const CONV_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  open:      { label: 'Open',      className: 'dlr-badge-sending' },
  closed:    { label: 'Closed',    className: 'dlr-badge-preview' },
  opted_out: { label: 'Opted Out', className: 'dlr-badge-live' },
}

export default async function DealerConversationPage({
  params,
}: {
  params: { conversationId: string }
}) {
  const session = await getDealerSession()
  if (!session) redirect('/login')
  if (session.user.role !== 'dealer') redirect('/dashboard')

  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, params.conversationId),
      eq(conversations.tenantId, session.user.tenantId)
    ),
    with: {
      lead: true,
      messages: { orderBy: (m, { asc }) => [asc(m.createdAt)] },
    },
  })

  if (!conversation) notFound()

  const { lead } = conversation
  const isHumanOwned    = !!conversation.humanTookOverAt
  const isOpen          = conversation.status === 'open'
  const isOptedOut      = conversation.status === 'opted_out'
  const isClosed        = conversation.status === 'closed'
  const canReply        = isOpen && isHumanOwned
  const statusBadge = CONV_STATUS_BADGE[conversation.status] ?? CONV_STATUS_BADGE.open
  const stateBadge = STATE_BADGE[lead.state] ?? { label: lead.state, className: 'dlr-badge-preview' }
  const initials = `${lead.firstName[0] ?? ''}${lead.lastName?.[0] ?? ''}`.toUpperCase()

  const showTakeOverBanner = isOpen

  // ── Lead score (derived from existing fields — no new data) ───────────
  // Heuristic blends: lead state, recency of activity, vehicle of interest,
  // and conversation length. Surfaces as the red glowing dial in the right panel.
  const recencyDays = lead.lastCrmActivityAt
    ? Math.floor((Date.now() - new Date(lead.lastCrmActivityAt).getTime()) / 86400000)
    : 999
  const stateBoost: Record<string, number> = {
    revived: 25, responded: 18, enrolled: 12, active: 5,
    stale: -5, exhausted: -10, opted_out: -25, dead: -15,
  }
  const messageBoost = Math.min(conversation.messages.length * 2, 18)
  const recencyBoost = recencyDays < 7 ? 12 : recencyDays < 30 ? 6 : recencyDays < 90 ? 0 : -8
  const vehicleBoost = lead.vehicleOfInterest ? 8 : 0
  const leadScore = Math.max(
    0,
    Math.min(100, 55 + (stateBoost[lead.state] ?? 0) + messageBoost + recencyBoost + vehicleBoost),
  )

  // Priority — visual classification only.
  const priority: 'HOT' | 'WARM' | 'COLD' =
    leadScore >= 75 ? 'HOT' : leadScore >= 45 ? 'WARM' : 'COLD'

  const tags: string[] = []
  if (lead.vehicleOfInterest) tags.push(lead.vehicleOfInterest)
  if (lead.salespersonName)   tags.push(`Rep: ${lead.salespersonName}`)
  if (recencyDays < 30)       tags.push('Recent activity')
  if (conversation.messages.length === 0) tags.push('New Lead')

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Center: Conversation ──────────────────────────────── */}
      <div
        className="flex-1 flex flex-col overflow-hidden"
        style={{ background: 'rgba(3,3,4,0.96)' }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-3 md:px-5 py-3 flex-shrink-0"
          style={{
            background: 'rgba(8,8,10,0.85)',
            borderBottom: '1px solid rgba(255,27,27,0.32)',
          }}
        >
          <Link
            href="/dealer/inbox"
            className="md:hidden flex-shrink-0 p-1.5 -ml-1 rounded-lg transition-colors"
            style={{ color: 'rgba(255,255,255,0.65)' }}
            aria-label="Back to inbox"
          >
            <ArrowLeft size={18} />
          </Link>
          <div
            className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-black"
            style={{
              background: 'linear-gradient(135deg, #1a0505, #3a0505)',
              border: '1px solid rgba(255,27,27,0.55)',
              boxShadow: '0 0 12px rgba(255,27,27,0.35)',
            }}
          >
            {initials || 'L'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-black text-white">
                {lead.firstName} {lead.lastName}
              </span>
              <span className={`dlr-badge ${statusBadge.className}`}>{statusBadge.label}</span>
              {conversation.messages.length === 0 && (
                <span className="dlr-badge dlr-badge-live">New Lead</span>
              )}
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
              {conversation.leadPhone}
              {lead.vehicleOfInterest && (
                <>
                  <span className="mx-1.5" style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
                  {lead.vehicleOfInterest}
                </>
              )}
              <span className="mx-1.5" style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>Received {new Date(conversation.messages[0]?.createdAt ?? conversation.updatedAt).toLocaleDateString()}</span>
            </p>
          </div>
          <a
            href={`tel:${conversation.leadPhone}`}
            className="inline-flex items-center justify-center w-10 h-10 rounded-lg transition-colors"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.85)',
            }}
            title="Call lead"
            aria-label="Call lead"
          >
            <Phone size={15} />
          </a>
        </div>

        {/* Red pulse line under header */}
        <div className="dlr-pulse-line flex-shrink-0" />

        <div
          className="flex-shrink-0 px-5 py-2.5"
          style={{
            background: 'rgba(255,255,255,0.03)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <p className="text-[11px] flex items-start gap-2" style={{ color: 'rgba(255,255,255,0.58)' }}>
            <AlertTriangle size={12} style={{ marginTop: 2, color: '#fbbf24', flexShrink: 0 }} />
            <span>
              Call actions use your phone directly. Only use <strong style={{ color: '#fff' }}>Call lead</strong>{' '}
              when you&apos;re ready to place a live call.
            </span>
          </p>
        </div>

        {/* Take-over banner */}
        {showTakeOverBanner && (
          <TakeOverBanner
            conversationId={conversation.id}
            alreadyTakenOver={!!conversation.humanTookOverAt}
          />
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 dlr-scrollbar">
          <MessageThread messages={conversation.messages} />
        </div>

        {/* Reply area */}
        {canReply ? (
          <div
            className="flex-shrink-0"
            style={{
              background: 'rgba(8,8,10,0.85)',
              borderTop: '1px solid rgba(255,27,27,0.3)',
            }}
          >
            <ReplyBox conversationId={conversation.id} />
          </div>
        ) : isOpen ? (
          <div
            className="flex-shrink-0 px-5 py-4"
            style={{
              background: 'rgba(245,158,11,0.10)',
              borderTop: '1px solid rgba(245,158,11,0.4)',
            }}
          >
            <p className="text-sm text-center" style={{ color: '#fbbf24' }}>
              Compose disabled while automation manages this conversation.
              Take over above to reply manually.
            </p>
          </div>
        ) : isOptedOut ? (
          <div
            className="flex-shrink-0 px-5 py-4"
            style={{
              background: 'rgba(255,27,27,0.10)',
              borderTop: '1px solid rgba(255,27,27,0.4)',
            }}
          >
            <p className="text-sm text-center font-bold" style={{ color: '#ff5252' }}>
              This lead opted out. Do not send messages.
            </p>
          </div>
        ) : isClosed ? (
          <div
            className="flex-shrink-0 px-5 py-4"
            style={{
              background: 'rgba(255,255,255,0.03)',
              borderTop: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <p className="text-sm text-center" style={{ color: 'rgba(255,255,255,0.5)' }}>Conversation is closed.</p>
          </div>
        ) : null}
      </div>

      {/* ── Right: Lead panel (desktop only) ─────────────────── */}
      <aside
        className="hidden lg:flex w-[300px] flex-shrink-0 flex-col overflow-hidden"
        style={{
          background: 'rgba(3,3,4,0.95)',
          borderLeft: '1px solid rgba(255,27,27,0.22)',
        }}
      >
        <div className="overflow-y-auto dlr-scrollbar flex-1">

          {/* Identity */}
          <div className="p-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-start gap-3">
              <div
                className="w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-black"
                style={{
                  background: 'linear-gradient(135deg, #1a0505, #3a0505)',
                  border: '1px solid rgba(255,27,27,0.55)',
                  boxShadow: '0 0 14px rgba(255,27,27,0.4)',
                }}
              >
                {initials || 'L'}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-black text-white">
                  {lead.firstName} {lead.lastName}
                </h3>
                <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{lead.phone}</p>
              </div>
            </div>
          </div>

          {/* Lead status / priority */}
          <div className="p-5 space-y-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>Lead Status</p>
            <div className="flex flex-wrap gap-2">
              <span className={`dlr-badge ${stateBadge.className}`}>{stateBadge.label}</span>
              <span className={`dlr-badge ${statusBadge.className}`}>{statusBadge.label}</span>
            </div>
            <PriorityRow priority={priority} />
          </div>

          {/* Lead score dial */}
          <div className="p-5 flex items-center gap-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <LeadScoreDial score={leadScore} />
            <div className="flex-1 min-w-0">
              <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>Lead Score</p>
              <p className="text-2xl font-black text-white mt-1 leading-none">{leadScore}</p>
              <p className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.5)' }}>
                {leadScore >= 75 ? 'Hot — prioritize outreach' :
                 leadScore >= 45 ? 'Warm — keep the sequence running' :
                                   'Cold — long-tail revival'}
              </p>
            </div>
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="p-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>Tags</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest"
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.7)',
                    }}
                  >
                    <Tag size={10} />
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Lead info */}
          <div className="p-5 space-y-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>Lead Info</p>
            <DetailRow
              icon={<User size={13} />}
              label="Last Contact"
              value={(() => {
                const lastMessage = conversation.messages[conversation.messages.length - 1]
                const ts =
                  lastMessage?.createdAt ??
                  lead.lastCrmActivityAt ??
                  lead.originalInquiryAt ??
                  null
                return ts
                  ? new Date(ts).toLocaleDateString('en-US', {
                      month: 'short',
                      day:   'numeric',
                      year:  'numeric',
                    })
                  : 'Unknown'
              })()}
            />
            {lead.salespersonName && (
              <DetailRow icon={<User size={13} />} label="Salesperson" value={lead.salespersonName} />
            )}
            <DetailRow
              icon={<MessageSquare size={13} />}
              label="Messages"
              value={`${conversation.messages.length} message${conversation.messages.length !== 1 ? 's' : ''}`}
            />
            {conversation.messages.length > 0 && (
              <DetailRow
                icon={<Calendar size={13} />}
                label="First Contact"
                value={new Date(conversation.messages[0].createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              />
            )}
            {conversation.humanTookOverAt && (
              <DetailRow
                icon={<User size={13} />}
                label="Taken Over"
                value={new Date(conversation.humanTookOverAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              />
            )}
          </div>

          {/* Vehicle interest */}
          {lead.vehicleOfInterest && (
            <div className="p-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>Vehicle Interest</p>
              <div
                className="flex items-center gap-2 mt-2 rounded-lg p-3"
                style={{
                  background: 'rgba(255,27,27,0.06)',
                  border: '1px solid rgba(255,27,27,0.22)',
                }}
              >
                <Car size={14} style={{ color: '#ff5252' }} />
                <span className="text-sm font-bold text-white">{lead.vehicleOfInterest}</span>
              </div>
            </div>
          )}

          {/* Actions — only show actions already supported by the app.
              Take Over lives in the banner above the thread (canonical
              source); we mirror it here as a quick reference + provide
              the always-available phone-call action. Mark-as-contacted /
              opt-out are gated behind a real backend, so they render as
              "Coming soon" links that don't fake any API call. */}
          <div className="p-5">
            <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>Actions</p>
            <div className="mt-3 space-y-2">
              <a
                href={`tel:${conversation.leadPhone}`}
                className="dlr-btn-secondary w-full"
                style={{ height: 40, fontSize: 12, justifyContent: 'flex-start' }}
                aria-label="Call lead"
                title="Call lead"
              >
                <Phone size={13} />
                Call lead now
              </a>
              {isOpen && !isHumanOwned && (
                <div
                  className="rounded-lg px-3 py-2 text-[11px] flex items-start gap-2"
                  style={{
                    background: 'rgba(255,27,27,0.06)',
                    border: '1px solid rgba(255,27,27,0.28)',
                    color: 'rgba(255,255,255,0.7)',
                  }}
                >
                  <Zap size={12} style={{ color: '#ff5252', marginTop: 2 }} />
                  <span>
                    Use the <strong className="font-black" style={{ color: '#ff5252' }}>Take Over</strong> banner above the
                    thread to reply manually.
                  </span>
                </div>
              )}
              {isOpen && isHumanOwned && (
                <div
                  className="rounded-lg px-3 py-2 text-[11px] flex items-start gap-2"
                  style={{
                    background: 'rgba(34,197,94,0.08)',
                    border: '1px solid rgba(34,197,94,0.35)',
                    color: '#4ade80',
                  }}
                >
                  <CheckCircle2 size={12} style={{ marginTop: 2 }} />
                  <span>You&apos;ve taken over. Reply directly below the thread.</span>
                </div>
              )}
              {isOptedOut && (
                <div
                  className="rounded-lg px-3 py-2 text-[11px] flex items-start gap-2"
                  style={{
                    background: 'rgba(255,27,27,0.08)',
                    border: '1px solid rgba(255,27,27,0.38)',
                    color: '#ff5252',
                  }}
                >
                  <Ban size={12} style={{ marginTop: 2 }} />
                  <span>Lead opted out — no further outreach permitted.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.45)' }}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</p>
        <p className="text-xs font-bold mt-0.5" style={{ color: 'rgba(255,255,255,0.85)' }}>{value}</p>
      </div>
    </div>
  )
}

function PriorityRow({ priority }: { priority: 'HOT' | 'WARM' | 'COLD' }) {
  const cfg = priority === 'HOT'
    ? { color: '#ff5252', bg: 'rgba(255,27,27,0.16)', border: 'rgba(255,27,27,0.55)', glow: '0 0 18px rgba(255,27,27,0.4)' }
    : priority === 'WARM'
    ? { color: '#fbbf24', bg: 'rgba(245,158,11,0.16)', border: 'rgba(245,158,11,0.55)', glow: 'none' }
    : { color: 'rgba(255,255,255,0.6)', bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.15)', glow: 'none' }

  return (
    <div className="flex items-center gap-2">
      <span className="dlr-cmd-label" style={{ color: 'rgba(255,255,255,0.5)' }}>Priority</span>
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-black uppercase tracking-widest"
        style={{
          background: cfg.bg,
          border: `1px solid ${cfg.border}`,
          color: cfg.color,
          boxShadow: cfg.glow,
        }}
      >
        {priority}
      </span>
    </div>
  )
}

function LeadScoreDial({ score }: { score: number }) {
  const radius = 28
  const stroke = 5
  const c = 2 * Math.PI * radius
  const offset = c - (score / 100) * c
  return (
    <div className="relative flex-shrink-0">
      <svg width={radius * 2 + stroke * 2} height={radius * 2 + stroke * 2}>
        <circle
          cx={radius + stroke}
          cy={radius + stroke}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        <circle
          cx={radius + stroke}
          cy={radius + stroke}
          r={radius}
          fill="none"
          stroke="#ff1b1b"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${radius + stroke} ${radius + stroke})`}
          style={{ filter: 'drop-shadow(0 0 8px rgba(255,27,27,0.75))' }}
        />
        <text
          x={radius + stroke}
          y={radius + stroke + 4}
          textAnchor="middle"
          fill="#fff"
          fontWeight="900"
          fontSize="14"
        >
          {score}
        </text>
      </svg>
    </div>
  )
}
