import { getServerSession } from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import Link from 'next/link'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { conversations } from '@/lib/db/schema'
import { MessageThread } from '@/components/inbox/MessageThread'
import { ReplyBox } from '@/components/inbox/ReplyBox'

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

  const canReply = conversation.status === 'open'

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-gray-200 bg-white flex-shrink-0">
        <Link href="/inbox" className="text-sm text-gray-400 hover:text-gray-600">
          ← Inbox
        </Link>
        <div>
          <span className="text-sm font-semibold text-gray-900">
            {conversation.lead.firstName} {conversation.lead.lastName}
          </span>
          <span className="ml-2 text-xs text-gray-400">{conversation.lead.phone}</span>
        </div>
        <span className={`ml-auto text-xs px-2 py-1 rounded-full font-medium ${
          conversation.status === 'opted_out'
            ? 'bg-red-100 text-red-700'
            : conversation.status === 'closed'
            ? 'bg-gray-100 text-gray-500'
            : 'bg-green-100 text-green-700'
        }`}>
          {conversation.status === 'opted_out' ? 'Opted out'
            : conversation.status === 'closed' ? 'Closed'
            : 'Open'}
        </span>
        <Link
          href={`/leads/${conversation.lead.id}`}
          className="text-xs text-blue-600 hover:underline"
        >
          View lead →
        </Link>
      </div>

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        <MessageThread messages={conversation.messages} />
      </div>

      {/* Reply box */}
      {canReply ? (
        <div className="flex-shrink-0 border-t border-gray-200 bg-white">
          <ReplyBox conversationId={conversation.id} />
        </div>
      ) : conversation.status === 'opted_out' ? (
        <div className="flex-shrink-0 border-t border-red-200 bg-red-50">
          <p className="px-6 py-4 text-sm text-center text-red-700">
            This lead has opted out. Messaging is disabled.
          </p>
        </div>
      ) : (
        <div className="flex-shrink-0 border-t border-gray-200 bg-white">
          <p className="px-6 py-4 text-sm text-gray-400 text-center">
            Conversation is closed.
          </p>
        </div>
      )}
    </div>
  )
}
