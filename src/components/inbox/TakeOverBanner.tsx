'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Zap, CheckCircle } from 'lucide-react'

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
    <div className="flex items-center justify-between gap-3 px-5 py-2.5"
      style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a' }}>
      <div className="flex items-center gap-2 text-sm" style={{ color: '#92400e' }}>
        <Zap size={15} className="flex-shrink-0" style={{ color: '#d97706' }} />
        <span>
          <strong>This lead is reviving.</strong> They replied to an automated message — DLR has paused further automation and alerted you.
        </span>
      </div>
      <button
        onClick={handleTakeOver}
        disabled={loading}
        className="flex-shrink-0 px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-60"
        style={{ background: '#d97706' }}
      >
        {loading ? 'Taking over…' : 'Take Over →'}
      </button>
    </div>
  )
}
