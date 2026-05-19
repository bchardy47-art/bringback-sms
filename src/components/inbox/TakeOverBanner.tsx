'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Zap, CheckCircle } from 'lucide-react'

/**
 * Take-over banner — sits at the top of a conversation thread.
 *
 * Two display states:
 *   - Not yet taken over (automation managing): amber banner explaining
 *     that automation is in charge, plus a "Take over conversation"
 *     button. Clicking the button shows a window.confirm() gate before
 *     posting to /api/conversations/[id]/take-over — that endpoint
 *     stamps humanTookOverAt, cancels the lead's enrollments, sets
 *     doNotAutomate=true, and cleans pending BullMQ jobs.
 *   - Taken over: green banner confirming the human is active and
 *     automation is paused.
 *
 * Render decision lives in the parent (page.tsx) — show this banner
 * whenever the conversation is open (not opted_out, not closed). The
 * parent also gates the reply compose box on the same humanTookOverAt
 * flag so an automated conversation can't accept a manual reply until
 * take-over is confirmed.
 */

const TAKE_OVER_CONFIRM_PROMPT =
  'Take over this conversation? Automation will pause for this lead ' +
  'until it is returned or handled manually.'

type Props = {
  conversationId: string
  /** already stamped when page loaded */
  alreadyTakenOver: boolean
}

export function TakeOverBanner({ conversationId, alreadyTakenOver }: Props) {
  const router = useRouter()
  const [taken, setTaken] = useState(alreadyTakenOver)
  const [loading, setLoading] = useState(false)

  async function handleTakeOver() {
    if (loading) return
    if (typeof window !== 'undefined') {
      const ok = window.confirm(TAKE_OVER_CONFIRM_PROMPT)
      if (!ok) return
    }
    setLoading(true)
    try {
      await fetch(`/api/conversations/${conversationId}/take-over`, {
        method: 'POST',
      })
      setTaken(true)
      // Refresh server data (lead state badge, etc.)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  if (taken) {
    return (
      <div className="flex items-center gap-2.5 px-5 py-2.5 text-sm font-medium"
        style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0', color: '#15803d' }}>
        <CheckCircle size={15} />
        Human Active — you have taken over this conversation. Automation is paused.
      </div>
    )
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-3"
      style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a' }}>
      <div className="flex items-start gap-2 text-sm min-w-0" style={{ color: '#92400e' }}>
        <Zap size={15} className="flex-shrink-0 mt-0.5" style={{ color: '#d97706' }} />
        <span>
          <strong>Automation is managing this conversation.</strong>{' '}
          Take over to reply manually. Automation will pause for this lead.
        </span>
      </div>
      <button
        onClick={handleTakeOver}
        disabled={loading}
        className="flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-60 self-start sm:self-auto"
        style={{ background: '#d97706' }}
      >
        {loading ? 'Taking over…' : 'Take over conversation'}
      </button>
    </div>
  )
}
