import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { conversations } from '@/lib/db/schema'

const LEAD_STATE_LABELS: Record<string, { label: string; color: string }> = {
  active:    { label: 'Active',    color: 'bg-gray-100 text-gray-600' },
  stale:     { label: 'Stale',     color: 'bg-yellow-100 text-yellow-700' },
  enrolled:  { label: 'Enrolled',  color: 'bg-blue-100 text-blue-700' },
  responded: { label: 'Responded', color: 'bg-green-100 text-green-700' },
  revived:   { label: 'Revived',   color: 'bg-emerald-100 text-emerald-700' },
  exhausted: { label: 'Exhausted', color: 'bg-red-100 text-red-600' },
  opted_out: { label: 'Opted out', color: 'bg-red-100 text-red-700' },
  dead:      { label: 'Dead',      color: 'bg-gray-100 text-gray-400' },
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: { status?: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const statusFilter = (searchParams.status ?? 'open') as 'open' | 'closed' | 'opted_out'

  const convos = await db.query.conversations.findMany({
    where: and(
      eq(conversations.tenantId, session.user.tenantId),
      eq(conversations.status, statusFilter)
    ),
    orderBy: [desc(conversations.updatedAt)],
    limit: 100,
    with: {
      lead: { columns: { id: true, firstName: true, lastName: true, phone: true, state: true } },
      messages: {
        orderBy: (m, { desc }) => [desc(m.createdAt)],
        limit: 1,
      },
    },
  })

  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold text-gray-900 mb-5">Inbox</h1>

      {/* Status tabs */}
      <div className="flex gap-2 mb-5">
        {(['open', 'closed', 'opted_out'] as const).map((s) => (
          <Link
            key={s}
            href={`/inbox?status=${s}`}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === s
                ? 'bg-gray-900 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {s === 'opted_out' ? 'Opted out' : s.charAt(0).toUpperCase() + s.slice(1)}
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
        {convos.length === 0 && (
          <p className="px-5 py-8 text-sm text-gray-400 text-center">No conversations.</p>
        )}
        {convos.map((conv) => {
          const lastMsg = conv.messages[0]
          return (
            <Link
              key={conv.id}
              href={`/inbox/${conv.id}`}
              className="flex items-center px-5 py-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">
                    {conv.lead.firstName} {conv.lead.lastName}
                  </span>
                  <span className="text-xs text-gray-400">{conv.lead.phone}</span>
                  {(() => {
                    const badge = LEAD_STATE_LABELS[conv.lead.state] ?? { label: conv.lead.state, color: 'bg-gray-100 text-gray-500' }
                    return (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badge.color}`}>
                        {badge.label}
                      </span>
                    )
                  })()}
                </div>
                {lastMsg && (
                  <p className="mt-0.5 text-xs text-gray-500 truncate">
                    {lastMsg.direction === 'outbound' ? '↑ ' : '↓ '}
                    {lastMsg.body}
                  </p>
                )}
              </div>
              <span className="text-xs text-gray-400 ml-4 flex-shrink-0">
                {new Date(conv.updatedAt).toLocaleDateString()}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
