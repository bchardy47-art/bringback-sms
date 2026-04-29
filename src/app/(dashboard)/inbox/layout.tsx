import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { conversations } from '@/lib/db/schema'
import { ConversationListSidebar } from '@/components/inbox/ConversationListSidebar'
import { Suspense } from 'react'

export default async function InboxLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const convos = await db.query.conversations.findMany({
    where: eq(conversations.tenantId, session.user.tenantId),
    orderBy: [desc(conversations.updatedAt)],
    limit: 200,
    with: {
      lead: {
        columns: { id: true, firstName: true, lastName: true, phone: true, state: true },
      },
      messages: {
        orderBy: (m, { desc }) => [desc(m.createdAt)],
        limit: 1,
      },
    },
  })

  return (
    <div className="flex h-full" style={{ height: '100vh' }}>
      {/* Left: Conversation list */}
      <div
        className="w-80 flex-shrink-0 bg-white flex flex-col overflow-hidden"
        style={{ borderRight: '1px solid #f0f0f0' }}
      >
        <Suspense>
          <ConversationListSidebar conversations={convos} totalOpen={0} />
        </Suspense>
      </div>

      {/* Right: Conversation detail */}
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  )
}
