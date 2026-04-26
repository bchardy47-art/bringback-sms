'use client'

import { useEffect, useRef } from 'react'

interface Message {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  status: string
  createdAt: Date
  workflowStepId?: string | null
}

export function MessageThread({ messages }: { messages: Message[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [messages])

  if (messages.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-8">No messages yet.</p>
  }

  return (
    <div className="space-y-3">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-sm rounded-2xl px-4 py-2.5 ${
              msg.direction === 'outbound'
                ? 'bg-blue-600 text-white rounded-br-sm'
                : 'bg-gray-100 text-gray-900 rounded-bl-sm'
            }`}
          >
            <p className="text-sm leading-relaxed">{msg.body}</p>
            <div className={`flex items-center gap-1.5 mt-1 text-xs ${
              msg.direction === 'outbound' ? 'text-blue-200 justify-end' : 'text-gray-400'
            }`}>
              <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              {msg.direction === 'outbound' && (
                <span>· {msg.status === 'delivered' ? '✓✓' : msg.status === 'sent' ? '✓' : msg.status === 'failed' ? '✗' : '…'}</span>
              )}
              {msg.workflowStepId && (
                <span title="Sent by workflow" className="opacity-60">⚡</span>
              )}
            </div>
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
