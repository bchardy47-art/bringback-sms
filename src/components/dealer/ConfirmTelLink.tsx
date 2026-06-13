'use client'

import type { CSSProperties, MouseEvent, ReactNode } from 'react'

type Props = {
  phone: string
  children: ReactNode
  className?: string
  style?: CSSProperties
  title?: string
  ariaLabel?: string
  confirmMessage?: string
}

export function ConfirmTelLink({
  phone,
  children,
  className,
  style,
  title,
  ariaLabel,
  confirmMessage = 'Place a live call to this lead now?',
}: Props) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (process.env.NODE_ENV === 'test') {
      event.preventDefault()
      return
    }
    if (typeof window === 'undefined') return
    if (!window.confirm(confirmMessage)) {
      event.preventDefault()
    }
  }

  return (
    <a
      href={`tel:${phone}`}
      className={className}
      style={style}
      title={title}
      aria-label={ariaLabel}
      onClick={handleClick}
    >
      {children}
    </a>
  )
}
