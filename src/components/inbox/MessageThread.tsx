'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

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
  const pathname = usePathname()
  const isDealer = pathname.startsWith('/dealer')

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [messages])

  if (messages.length === 0) {
    if (isDealer) {
      return (
        <div className="text-center py-10 px-4">
          <p className="text-sm font-bold text-white">No messages in this conversation yet.</p>
          <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Messages will appear here as DLR sends and as the lead replies.
          </p>
        </div>
      )
    }
    return (
      <div className="text-center py-10 px-4">
        <p className="text-sm font-medium text-gray-600">No messages in this conversation yet.</p>
        <p className="text-xs text-gray-400 mt-1">
          Messages will appear here as DLR sends and as the lead replies.
        </p>
      </div>
    )
  }

  if (isDealer) {
    return (
      <div className="space-y-3">
        {messages.map((msg) => {
          const isOutbound = msg.direction === 'outbound'
          return (
            <div
              key={msg.id}
              className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className="max-w-sm rounded-2xl px-4 py-2.5"
                style={
                  isOutbound
                    ? {
                        background: 'linear-gradient(180deg, rgba(255,27,27,0.18), rgba(58,5,5,0.5))',
                        border: '1px solid rgba(255,27,27,0.6)',
                        boxShadow: '0 0 16px rgba(255,27,27,0.32)',
                        color: 'white',
                        borderBottomRightRadius: 4,
                      }
                    : {
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: 'rgba(255,255,255,0.92)',
                        borderBottomLeftRadius: 4,
                      }
                }
              >
                <p className="text-sm leading-relaxed">{msg.body}</p>
                <div
                  className={`flex items-center gap-1.5 mt-1 text-[10px] ${isOutbound ? 'justify-end' : ''}`}
                  style={{ color: isOutbound ? 'rgba(255,200,200,0.7)' : 'rgba(255,255,255,0.45)' }}
                >
                  <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {isOutbound && (
                    <span>· {msg.status === 'delivered' ? '✓✓' : msg.status === 'sent' ? '✓' : msg.status === 'failed' ? '✗' : '…'}</span>
                  )}
                  {msg.workflowStepId && (
                    <span title="Sent by workflow" style={{ opacity: 0.8 }}>⚡</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    )
  }

  // Admin / light theme — unchanged
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
