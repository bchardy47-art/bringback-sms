import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { Suspense } from 'react'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { conversations } from '@/lib/db/schema'
import { ConversationListSidebar } from '@/components/inbox/ConversationListSidebar'
import { InboxLayoutClient } from '@/components/inbox/InboxLayoutClient'

export default async function DealerInboxLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'dealer') redirect('/dashboard')

  const convos = await db.query.conversations.findMany({
    where: eq(conversations.tenantId, session.user.tenantId),
    orderBy: [desc(conversations.updatedAt)],
    limit: 200,
    columns: {
      id: true,
      status: true,
      updatedAt: true,
      leadId: true,
      humanTookOverAt: true,
    },
    with: {
      lead: {
        columns: { id: true, firstName: true, lastName: true, phone: true, state: true },
      },
      messages: {
        orderBy: (m, { desc }) => [desc(m.createdAt)],
        limit: 1,
        columns: { direction: true, body: true, createdAt: true },
      },
    },
  })

  const sidebar = (
    <Suspense>
      <ConversationListSidebar
        conversations={convos}
        totalOpen={0}
        basePath="/dealer/inbox"
      />
    </Suspense>
  )

  return (
    <InboxLayoutClient sidebar={sidebar}>
      {children}
    </InboxLayoutClient>
  )
}
