'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Zap, CheckCircle } from 'lucide-react'

const TAKE_OVER_CONFIRM_PROMPT =
  'Take over this conversation? Automation will pause for this lead ' +
  'until it is returned or handled manually.'

type Props = {
  conversationId: string
  alreadyTakenOver: boolean
}

export function TakeOverBanner({ conversationId, alreadyTakenOver }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [taken, setTaken] = useState(alreadyTakenOver)
  const [loading, setLoading] = useState(false)
  const isDealer = pathname.startsWith('/dealer')

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
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  if (isDealer) {
    if (taken) {
      return (
        <div
          className="flex items-center gap-2.5 px-5 py-2.5 text-sm font-bold"
          style={{
            background: 'rgba(34,197,94,0.12)',
            borderBottom: '1px solid rgba(34,197,94,0.4)',
            color: '#4ade80',
          }}
        >
          <CheckCircle size={15} />
          Human Active — you have taken over this conversation. Automation is paused.
        </div>
      )
    }

    return (
      <div
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-3"
        style={{
          background: 'rgba(245,158,11,0.10)',
          borderBottom: '1px solid rgba(245,158,11,0.4)',
        }}
      >
        <div className="flex items-start gap-2 text-sm min-w-0" style={{ color: '#fbbf24' }}>
          <Zap size={15} className="flex-shrink-0 mt-0.5" />
          <span>
            <strong className="font-black">Automation is managing this conversation.</strong>{' '}
            Take over to reply manually. Automation will pause for this lead.
          </span>
        </div>
        <button
          onClick={handleTakeOver}
          disabled={loading}
          className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-opacity disabled:opacity-60 self-start sm:self-auto"
          style={{
            background: 'linear-gradient(180deg, #ff2929 0%, #a80d0d 100%)',
            border: '1px solid rgba(255,80,80,0.78)',
            color: 'white',
            boxShadow: '0 0 14px rgba(255,27,27,0.5), inset 0 1px 0 rgba(255,255,255,0.18)',
          }}
        >
          <Zap size={13} />
          {loading ? 'Taking over…' : 'Take Over'}
        </button>
      </div>
    )
  }

  // Admin / light theme — unchanged
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
