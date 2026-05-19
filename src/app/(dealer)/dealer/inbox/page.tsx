import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { and, count, eq, inArray } from 'drizzle-orm'
import { MessageSquare, Send, Clock } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { conversations, pilotBatches } from '@/lib/db/schema'

// The parent layout (./layout.tsx) is dynamic — it calls getServerSession
// and queries the conversation list on every request. This page is otherwise
// statically analyzable, which lets Next.js cache its RSC payload at build
// time. When a soft-nav _rsc request arrives for /dealer/inbox?status=X,
// Next.js then has to combine the cached static-page payload with a fresh
// dynamic-layout payload, and the static/dynamic boundary trips a 503 in
// the RSC flight handler for that combined response.
//
// Forcing the page dynamic keeps both halves of the response on the same
// fresh-render code path.
export const dynamic = 'force-dynamic'

export default async function DealerInboxPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'dealer') redirect('/dashboard')

  const tenantId = session.user.tenantId

  // Context-aware empty state. Two cheap counts:
  //   conversationCount  — has any lead-thread been created? (proxy for
  //                        "we have sent at least one message")
  //   launchedBatchCount — has a campaign batch reached approved/sending/
  //                        completed? (proxy for "the dealer has reached
  //                        the actual launch step")
  // If conversationCount > 0 we always show the neutral "Select a conversation"
  // hint, regardless of batch state.
  const [convRows, launchedRows] = await Promise.all([
    db.select({ c: count() })
      .from(conversations)
      .where(eq(conversations.tenantId, tenantId)),
    db.select({ c: count() })
      .from(pilotBatches)
      .where(and(
        eq(pilotBatches.tenantId, tenantId),
        inArray(pilotBatches.status, ['approved', 'sending', 'paused', 'completed']),
      )),
  ])
  const conversationCount  = convRows[0]?.c ?? 0
  const launchedBatchCount = launchedRows[0]?.c ?? 0

  // ── State selection ───────────────────────────────────────────────────────
  // 1. conversations exist → user just hasn't selected one
  // 2. no convos + no launched batches → pre-launch
  // 3. no convos + has launched batches → mid-launch, sends in flight
  type State = 'pick_one' | 'pre_launch' | 'mid_launch'
  const state: State =
    conversationCount > 0 ? 'pick_one' :
    launchedBatchCount === 0 ? 'pre_launch' :
    'mid_launch'

  return (
    <div className="flex-1 flex items-center justify-center h-full bg-gray-50 p-6">
      <div className="text-center max-w-md">
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${
          state === 'pick_one'   ? 'bg-gray-100' :
          state === 'mid_launch' ? 'bg-blue-50'  :
                                   'bg-amber-50'
        }`}>
          {state === 'pick_one'   ? <MessageSquare size={28} className="text-gray-400" /> :
           state === 'mid_launch' ? <Send         size={26} className="text-blue-500" /> :
                                    <Clock        size={26} className="text-amber-600" />}
        </div>

        {state === 'pick_one' && (
          <>
            <h2 className="text-base font-semibold text-gray-700">Select a conversation</h2>
            <p className="text-sm text-gray-500 mt-1">
              Pick a thread from the sidebar to view the conversation.
            </p>
          </>
        )}

        {state === 'mid_launch' && (
          <>
            <h2 className="text-base font-semibold text-gray-800">DLR is preparing your first sends</h2>
            <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">
              Replies will appear here once leads respond — usually within 24–72 hours
              of the first send.
            </p>
            <p className="text-xs text-gray-400 mt-3">
              Nothing to do right now. We&apos;ll let you know when a hot reply lands.
            </p>
          </>
        )}

        {state === 'pre_launch' && (
          <>
            <h2 className="text-base font-semibold text-gray-800">No conversations yet</h2>
            <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">
              Replies will appear here after your first approved campaign sends.
              You haven&apos;t launched one yet — your dashboard shows the next setup step.
            </p>
            <a
              href="/dealer/dashboard"
              className="mt-4 inline-block px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-700 transition-colors"
            >
              Check setup progress →
            </a>
          </>
        )}
      </div>
    </div>
  )
}
