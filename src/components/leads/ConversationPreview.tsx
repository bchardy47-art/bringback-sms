'use client'

import { useEffect, useRef } from 'react'

interface Message {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  status: string
  createdAt: Date
}

export function ConversationPreview({ messages }: { messages: Message[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [])

  return (
    <div className="space-y-2 max-h-72 overflow-y-auto mb-3">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`text-sm px-3 py-2 rounded-lg max-w-xs ${
            msg.direction === 'outbound'
              ? 'ml-auto bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-800'
          }`}
        >
          <p>{msg.body}</p>
          <p className={`text-xs mt-1 ${msg.direction === 'outbound' ? 'text-blue-200' : 'text-gray-400'}`}>
            {new Date(msg.createdAt).toLocaleString()} · {msg.status}
          </p>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
