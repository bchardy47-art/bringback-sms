'use client'

import { useState, useRef, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

export function ReplyBox({ conversationId }: { conversationId: string }) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return

    setSending(true)
    setError(null)

    const res = await fetch(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: body.trim() }),
    })

    setSending(false)

    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Failed to send.')
      return
    }

    setBody('')
    router.refresh()
    textareaRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter') return
    // Shift+Enter: let the textarea insert a newline.
    if (e.shiftKey) return
    // IME composition (Japanese/Chinese/Korean input, voice dictation): the
    // Enter that confirms a candidate must not also submit the form.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    // Re-check sending + non-empty here so a stuck send + a stale ref'd
    // closure can't double-submit.
    if (sending || !body.trim()) return
    handleSubmit(e as unknown as FormEvent)
  }

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
