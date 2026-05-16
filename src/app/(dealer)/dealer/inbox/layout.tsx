import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { conversations } from '@/lib/db/schema'
import { ConversationListSidebar } from '@/components/inbox/ConversationListSidebar'
import { InboxLayoutClient } from '@/components/inbox/InboxLayoutClient'

// Tab navigations on /dealer/inbox?status=X trigger soft-nav _rsc fetches
// that re-render this layout. Previously this file was only implicitly
// dynamic via getServerSession, and the empty <Suspense> boundary that
// wrapped ConversationListSidebar (added because the downstream client
// component reads useSearchParams) interacted badly with the partial
// layout _rsc refetch path: Next.js streamed partial chunks then aborted,
// Caddy converted the dropped stream into 503 for the browser. (Next.js
// itself never returns 503 — verified by grepping its compiled runtime.)
//
// Marking the layout explicitly force-dynamic puts Next.js's flight
// handler on the same fresh-render code path that SSR initial load uses
// (already known to work). useSearchParams's Suspense requirement only
// applies to statically-analyzable subtrees, so once the whole layout is
// explicitly dynamic the wrapper is no longer required — removing it
// also removes the partial-stream code path that caused the 503.
export const dynamic = 'force-dynamic'

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
    <ConversationListSidebar
      conversations={convos}
      totalOpen={0}
      basePath="/dealer/inbox"
    />
  )

  return (
    <InboxLayoutClient sidebar={sidebar}>
      {children}
    </InboxLayoutClient>
  )
}
