'use client'

import { useState, useRef, useEffect } from 'react'
import { Info } from 'lucide-react'

interface InfoTooltipProps {
  text: string
  /** 'up' (default) | 'down' — which side the tooltip appears */
  direction?: 'up' | 'down'
}

export function InfoTooltip({ text, direction = 'up' }: InfoTooltipProps) {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!visible) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setVisible(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [visible])

  return (
    <div
      ref={ref}
      className="relative inline-flex flex-shrink-0"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label="More information"
        className="flex items-center justify-center rounded-full transition-all duration-150"
        style={{
          width: 18,
          height: 18,
          color: visible ? '#6b7280' : '#c4c9d4',
        }}
      >
        <Info size={13} strokeWidth={2} />
      </button>

      {visible && (
        <div
          className="absolute z-50 w-60 rounded-xl text-xs leading-relaxed"
          style={{
            ...(direction === 'up'
              ? { bottom: 'calc(100% + 8px)' }
              : { top: 'calc(100% + 8px)' }),
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#111827',
            color: '#e5e7eb',
            padding: '10px 12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.12)',
            pointerEvents: 'none',
            lineHeight: 1.6,
          }}
        >
          {text}
          {/* Arrow */}
          <span
            className="absolute"
            style={{
              ...(direction === 'up'
                ? { bottom: -5, borderTop: '5px solid #111827', borderBottom: 'none' }
                : { top: -5, borderBottom: '5px solid #111827', borderTop: 'none' }),
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
            }}
          />
        </div>
      )}
    </div>
  )
}
