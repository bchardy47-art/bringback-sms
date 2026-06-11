'use client'

import { useState, useRef, FormEvent } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Send, FileText, MessageSquare } from 'lucide-react'

export function ReplyBox({ conversationId }: { conversationId: string }) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'reply' | 'note'>('reply')
  const router = useRouter()
  const pathname = usePathname()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isDealer = pathname.startsWith('/dealer')

  function confirmSend(): boolean {
    if (typeof window === 'undefined') return true
    return window.confirm(
      'Send this message now? This will send a real message to the lead.',
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    // Internal notes are not supported by the API surface; only 'reply' sends.
    if (mode !== 'reply') return
    if (!confirmSend()) return

    setSending(true)
    setError(null)

    let res: Response
    try {
      res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body.trim() }),
      })
    } catch {
      setSending(false)
      setError('Network error. Check your connection and try again.')
      return
    }

    setSending(false)

    if (!res.ok) {
      let serverError: string | undefined
      try {
        const data = await res.json()
        if (typeof data?.error === 'string') serverError = data.error
      } catch {
        // fall through to the status-based fallback below
      }
      setError(serverError ?? `Send failed (HTTP ${res.status}). Please try again.`)
      return
    }

    setBody('')
    router.refresh()
    textareaRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter') return
    if (e.shiftKey) return
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (sending || !body.trim() || mode !== 'reply') return
    handleSubmit(e as unknown as FormEvent)
  }

  if (isDealer) {
    return (
      <form onSubmit={handleSubmit} className="px-4 py-3" style={{ background: 'rgba(3,3,4,0.92)' }}>
        {/* Reply / Internal Note tabs */}
        <div className="flex gap-2 mb-2">
          <button
            type="button"
            onClick={() => setMode('reply')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-widest transition-colors"
            style={
              mode === 'reply'
                ? {
                    background: 'rgba(255,27,27,0.2)',
                    border: '1px solid rgba(255,27,27,0.7)',
                    boxShadow: '0 0 14px rgba(255,27,27,0.28)',
                    color: '#fff',
                  }
                : {
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'rgba(255,255,255,0.55)',
                  }
            }
          >
            <MessageSquare size={12} />
            Reply
          </button>
          <button
            type="button"
            onClick={() => setMode('note')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-widest transition-colors"
            style={
              mode === 'note'
                ? {
                    background: 'rgba(245,158,11,0.18)',
                    border: '1px solid rgba(245,158,11,0.55)',
                    color: '#fbbf24',
                  }
                : {
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'rgba(255,255,255,0.55)',
                  }
            }
          >
            <FileText size={12} />
            Internal Note
          </button>
          <div className="flex-1" />
          <span className="text-[10px] self-center" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {body.length}/1600
          </span>
        </div>

        {mode === 'note' && (
          <p className="mb-2 text-[11px]" style={{ color: '#fbbf24' }}>
            Internal notes aren&apos;t saved to the lead record yet — switch to Reply to send a message.
          </p>
        )}

        <div className="flex gap-3 items-end">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={mode === 'reply' ? 'Type your message...' : 'Add an internal note for your team...'}
            rows={2}
            maxLength={1600}
            className="flex-1 resize-none rounded-lg px-3 py-2.5 text-sm outline-none transition-colors"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'white',
            }}
          />
          <button
            type="submit"
            disabled={sending || !body.trim() || mode !== 'reply'}
            className="inline-flex items-center gap-2 px-4 rounded-lg text-xs font-black uppercase tracking-widest disabled:cursor-not-allowed transition-all"
            style={
              sending || !body.trim() || mode !== 'reply'
                ? {
                    height: 44,
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'var(--dlr-muted-dark)',
                  }
                : {
                    height: 44,
                    background: 'linear-gradient(180deg, #ff2929 0%, #a80d0d 100%)',
                    border: '1px solid rgba(255,80,80,0.78)',
                    color: 'white',
                    boxShadow: '0 0 18px rgba(255,27,27,0.55), inset 0 1px 0 rgba(255,255,255,0.18)',
                  }
            }
          >
            {sending ? 'Sending…' : 'Send'}
            <Send size={13} />
          </button>
        </div>
        {error && <p className="mt-1.5 text-xs" style={{ color: '#ff5252' }}>{error}</p>}
      </form>
    )
  }

  // Admin / light theme — unchanged
  return (
    <form onSubmit={handleSubmit} className="px-6 py-4">
      <div className="flex gap-3 items-end">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message… (↵ to send, ⇧↵ for newline)"
          rows={2}
          maxLength={1600}
          className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={sending || !body.trim()}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <p className="mt-1 text-xs text-gray-400">{body.length}/1600</p>
    </form>
  )
}
