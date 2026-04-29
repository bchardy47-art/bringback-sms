import { getServerSession } from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import Link from 'next/link'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { conversations } from '@/lib/db/schema'
import { MessageThread } from '@/components/inbox/MessageThread'
import { ReplyBox } from '@/components/inbox/ReplyBox'
import { TakeOverBanner } from '@/components/inbox/TakeOverBanner'
import {
  Phone,
  ExternalLink,
  Car,
  Calendar,
  User,
  MessageSquare,
  Clock,
} from 'lucide-react'

const STATE_STYLES: Record<string, { label: string; color: string }> = {
  active:    { label: 'Active',    color: 'bg-gray-100 text-gray-700' },
  stale:     { label: 'Stale',     color: 'bg-yellow-100 text-yellow-700' },
  enrolled:  { label: 'Enrolled',  color: 'bg-blue-100 text-blue-700' },
  responded: { label: 'Responded', color: 'bg-green-100 text-green-700' },
  revived:   { label: 'Revived',   color: 'bg-emerald-100 text-emerald-700' },
  exhausted: { label: 'Exhausted', color: 'bg-red-100 text-red-600' },
  opted_out: { label: 'Opted Out', color: 'bg-red-100 text-red-700' },
  dead:      { label: 'Dead',      color: 'bg-gray-100 text-gray-400' },
}

const CONV_STATUS_STYLES: Record<string, { label: string; color: string }> = {
  open:      { label: 'Open',      color: 'bg-green-100 text-green-700' },
  closed:    { label: 'Closed',    color: 'bg-gray-100 text-gray-500' },
  opted_out: { label: 'Opted Out', color: 'bg-red-100 text-red-700' },
}

const AVATAR_COLORS = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#be185d']
function nameToColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export default async function ConversationPage({
  params,
}: {
  params: { conversationId: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

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
  const canReply = conversation.status === 'open'
  const statusStyle = CONV_STATUS_STYLES[conversation.status] ?? CONV_STATUS_STYLES.open
  const stateStyle = STATE_STYLES[lead.state] ?? { label: lead.state, color: 'bg-gray-100 text-gray-600' }
  const initials = `${lead.firstName[0] ?? ''}${lead.lastName?.[0] ?? ''}`.toUpperCase()
  const avatarColor = nameToColor(lead.firstName)

  return (
    <div className="flex h-full overflow-hidden">
      {/* Center: Message Thread */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
        {/* Thread header */}
        <div className="flex items-center gap-3 px-5 py-4 bg-white border-b border-gray-200 flex-shrink-0">
          <div
            className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold"
            style={{ backgroundColor: avatarColor }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-900">
                {lead.firstName} {lead.lastName}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusStyle.color}`}>
                {statusStyle.label}
              </span>
            </div>
            <p className="text-xs text-gray-500">{conversation.leadPhone}</p>
          </div>
          <a
            href={`tel:${conversation.leadPhone}`}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            title="Call"
          >
            <Phone size={16} />
          </a>
        </div>

        {/* Revival alert banner — shown for responded leads until takeover */}
        {(lead.state === 'responded' || conversation.humanTookOverAt) && (
          <TakeOverBanner
            conversationId={conversation.id}
            alreadyTakenOver={!!conversation.humanTookOverAt}
          />
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
          <MessageThread messages={conversation.messages} />
        </div>

        {/* Reply area */}
        {canReply ? (
          <div className="flex-shrink-0 bg-white border-t border-gray-200">
            <ReplyBox conversationId={conversation.id} />
          </div>
        ) : conversation.status === 'opted_out' ? (
          <div className="flex-shrink-0 border-t border-red-200 bg-red-50 px-5 py-4">
            <p className="text-sm text-center text-red-700 font-medium">
              This lead has opted out — messaging is disabled.
            </p>
          </div>
        ) : (
          <div className="flex-shrink-0 border-t border-gray-200 bg-white px-5 py-4">
            <p className="text-sm text-gray-400 text-center">Conversation is closed.</p>
          </div>
        )}
      </div>

      {/* Right: Lead Details Panel */}
      <div
        className="w-72 flex-shrink-0 bg-white flex flex-col overflow-hidden"
        style={{ borderLeft: '1px solid #f0f0f0' }}
      >
        <div className="overflow-y-auto scrollbar-thin flex-1">
          {/* Lead identity */}
          <div className="p-5 border-b border-gray-100">
            <div className="flex items-start gap-3">
              <div
                className="w-11 h-11 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-bold"
                style={{ backgroundColor: avatarColor }}
              >
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stateStyle.color}`}>
                    {stateStyle.label}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-gray-900 mt-1">
                  {lead.firstName} {lead.lastName}
                </h3>
                <p className="text-xs text-gray-500">{lead.phone}</p>
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="p-5 space-y-4 border-b border-gray-100">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Lead Info</h4>
            <DetailRow icon={<User size={14} />} label="Last Contact" value={
              lead.lastCrmActivityAt
                ? new Date(lead.lastCrmActivityAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : 'Unknown'
            } />
            {lead.salespersonName && (
              <DetailRow icon={<User size={14} />} label="Salesperson" value={lead.salespersonName} />
            )}
            {lead.crmSource && (
              <DetailRow icon={<Clock size={14} />} label="Source" value={lead.crmSource.toUpperCase()} />
            )}
            <DetailRow
              icon={<MessageSquare size={14} />}
              label="Messages"
              value={`${conversation.messages.length} message${conversation.messages.length !== 1 ? 's' : ''}`}
            />
            {conversation.messages.length > 0 && (
              <DetailRow
                icon={<Calendar size={14} />}
                label="First Contact"
                value={new Date(conversation.messages[0].createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              />
            )}
          </div>

          {/* Vehicle interest */}
          {lead.vehicleOfInterest && (
            <div className="p-5 border-b border-gray-100">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Vehicle Interest</h4>
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-3">
                <Car size={16} className="text-gray-400 flex-shrink-0" />
                <span className="text-sm text-gray-700 font-medium">{lead.vehicleOfInterest}</span>
              </div>
            </div>
          )}

          {/* Quick actions */}
          <div className="p-5">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Quick Actions</h4>
            <div className="space-y-1">
              <Link
                href={`/leads/${lead.id}`}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
              >
                <ExternalLink size={15} className="text-gray-400" />
                View Lead Profile
              </Link>
            </div>
          </div>
        </div>
      </div>
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
      <span className="text-gray-400 mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-xs font-medium text-gray-700 mt-0.5">{value}</p>
      </div>
    </div>
  )
}
