import { redirect } from 'next/navigation'
import { and, count, eq, inArray } from 'drizzle-orm'
import { MessageSquare, Send, Clock } from 'lucide-react'
import { getDealerSession } from '@/lib/dealer/dev-auth-bypass'
import { db } from '@/lib/db'
import { conversations, pilotBatches } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

export default async function DealerInboxPage() {
  const session = await getDealerSession()
  if (!session) redirect('/login')
  if (session.user.role !== 'dealer') redirect('/dashboard')

  const tenantId = session.user.tenantId

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

  type State = 'pick_one' | 'pre_launch' | 'mid_launch'
  const state: State =
    conversationCount > 0 ? 'pick_one' :
    launchedBatchCount === 0 ? 'pre_launch' :
    'mid_launch'

  return (
    <div
      className="flex-1 flex items-center justify-center h-full p-6 relative overflow-hidden"
      style={{
        background:
          'radial-gradient(circle at 50% 30%, rgba(255,27,27,0.18), transparent 40%), linear-gradient(180deg, #030304 0%, #08080a 50%, #030304 100%)',
      }}
    >
      {/* Subtle grid */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0.7), transparent 70%)',
        }}
      />
      <div className="text-center max-w-md relative z-10">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{
            background:
              state === 'pick_one'
                ? 'rgba(255,255,255,0.05)'
                : state === 'mid_launch'
                ? 'rgba(255,27,27,0.14)'
                : 'rgba(245,158,11,0.14)',
            border: state === 'pick_one'
              ? '1px solid rgba(255,255,255,0.08)'
              : state === 'mid_launch'
              ? '1px solid rgba(255,27,27,0.5)'
              : '1px solid rgba(245,158,11,0.5)',
            boxShadow: state === 'mid_launch'
              ? '0 0 22px rgba(255,27,27,0.4)'
              : 'none',
          }}
        >
          {state === 'pick_one'   ? <MessageSquare size={28} style={{ color: 'rgba(255,255,255,0.5)' }} /> :
           state === 'mid_launch' ? <Send         size={26} style={{ color: '#ff5252' }} /> :
                                    <Clock        size={26} style={{ color: '#fbbf24' }} />}
        </div>

        {state === 'pick_one' && (
          <>
            <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>Inbox Standby</p>
            <h2 className="text-xl font-black text-white mt-2 uppercase tracking-wide">Select a conversation</h2>
            <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Pick a thread from the sidebar to view the conversation.
            </p>
          </>
        )}

        {state === 'mid_launch' && (
          <>
            <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>First Sends</p>
            <h2 className="text-xl font-black text-white mt-2 uppercase tracking-wide">First sends are being prepared</h2>
            <p className="text-sm mt-2 leading-relaxed" style={{ color: 'rgba(255,255,255,0.65)' }}>
              Replies will appear here once leads respond — usually within 24–72 hours
              of the first send.
            </p>
            <p className="text-xs mt-4 italic" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Nothing to do right now. We&apos;ll let you know when a hot reply lands.
            </p>
          </>
        )}

        {state === 'pre_launch' && (
          <>
            <p className="dlr-cmd-label" style={{ color: '#fbbf24' }}>Pre-Launch</p>
            <h2 className="text-xl font-black text-white mt-2 uppercase tracking-wide">No conversations yet</h2>
            <p className="text-sm mt-2 leading-relaxed" style={{ color: 'rgba(255,255,255,0.65)' }}>
              Replies will appear here after your first approved campaign sends.
              You haven&apos;t launched one yet — your dashboard shows the next setup step.
            </p>
            <a href="/dealer/dashboard" className="dlr-btn-primary mt-5 inline-flex">
              Check setup progress
              <Send size={14} />
            </a>
          </>
        )}
      </div>
    </div>
  )
}
