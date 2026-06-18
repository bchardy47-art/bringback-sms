import type { Metadata } from 'next'
import Image from 'next/image'
import { BookDemoForm } from './BookDemoForm'

export const metadata: Metadata = {
  title: 'Book a Demo — DLR Dead Lead Revival',
  description: 'Your dealership already paid for the leads. DLR helps bring old, missed, and inactive prospects back into real conversations.',
  robots: 'index, follow',
}

const BULLETS = [
  {
    icon: '🔌',
    title: 'Plugs into your CRM',
    body: 'No rip-and-replace. Works alongside your existing tools.',
  },
  {
    icon: '⚡',
    title: 'Wake up old leads',
    body: 'Reignite interest from missed, aged, and inactive prospects.',
  },
  {
    icon: '📅',
    title: 'Book more appointments',
    body: 'Close more deals from leads you already paid for.',
  },
]

export default function BookDemoPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-0)',
      fontFamily: 'var(--f-body)',
      color: 'var(--tx)',
      display: 'flex',
      flexDirection: 'column',
    }}>

      {/* Header bar */}
      <div style={{
        borderBottom: '1px solid var(--line-red)',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(255,27,27,0.03)',
      }}>
        <Image
          src="/brand/dlr-logo.png"
          alt="DLR — Dead Lead Revival"
          width={140}
          height={44}
          priority
          style={{ height: 'auto' }}
        />
      </div>

      {/* Main content */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '48px 20px 64px',
        gap: 0,
      }}>

        {/* Hero text */}
        <div style={{ maxWidth: 680, width: '100%', textAlign: 'center', marginBottom: 40 }}>
          <p className="eyebrow red" style={{ marginBottom: 14 }}>Dead Lead Revival</p>
          <h1 style={{
            fontFamily: 'var(--f-display)',
            fontSize: 'clamp(36px, 7vw, 62px)',
            fontWeight: 900,
            lineHeight: 0.95,
            letterSpacing: '-0.01em',
            textTransform: 'uppercase',
            color: 'var(--tx-hi)',
            margin: '0 0 16px',
          }}>
            Ready to Revive<br />
            <span style={{ color: 'var(--red-core)' }}>Your Dead Leads?</span>
          </h1>
          <p style={{
            fontSize: 17,
            color: 'var(--tx-mid)',
            lineHeight: 1.65,
            maxWidth: 540,
            margin: '0 auto',
          }}>
            Your dealership already paid for the leads. DLR helps bring old, missed, and
            inactive prospects back into real conversations.
          </p>
        </div>

        {/* Two-column layout: bullets + form */}
        <div style={{
          maxWidth: 920,
          width: '100%',
          display: 'flex',
          gap: 32,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}>

          {/* Left: value props */}
          <div style={{
            flex: '1 1 320px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            paddingTop: 8,
          }}>
            {BULLETS.map(({ icon, title, body }) => (
              <div key={title} style={{
                display: 'flex',
                gap: 14,
                padding: '16px 18px',
                borderRadius: 14,
                background: 'rgba(255,255,255,0.025)',
                border: '1px solid var(--line)',
              }}>
                <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0, paddingTop: 2 }}>
                  {icon}
                </span>
                <div>
                  <p style={{
                    margin: '0 0 4px',
                    fontSize: 13, fontWeight: 700, color: 'var(--tx-hi)',
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                  }}>
                    {title}
                  </p>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--tx-mid)', lineHeight: 1.55 }}>
                    {body}
                  </p>
                </div>
              </div>
            ))}

            {/* Intent block */}
            <div style={{
              padding: '16px 18px',
              borderRadius: 14,
              background: 'rgba(255,42,42,0.06)',
              border: '1px solid rgba(255,42,42,0.18)',
            }}>
              <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--red-core)' }}>
                🎯 More opportunity. Less waste.
              </p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--tx-mid)', lineHeight: 1.6 }}>
                DLR targets leads showing real intent so your team can focus on buyers
                who are actually responding.
              </p>
            </div>
          </div>

          {/* Right: form card */}
          <div className="glass" style={{
            flex: '0 1 400px',
            padding: '28px 28px 32px',
            minWidth: 300,
          }}>
            <div style={{ marginBottom: 20 }}>
              <p className="eyebrow red" style={{ marginBottom: 8 }}>
                Book Your DLR Demo
              </p>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--tx-lo)' }}>
                Takes less than 60 seconds.
              </p>
            </div>

            <BookDemoForm />
          </div>

        </div>
      </div>

      {/* Footer */}
      <div style={{
        borderTop: '1px solid var(--line)',
        padding: '16px 24px',
        textAlign: 'center',
        fontSize: 11,
        color: 'var(--tx-lo)',
        letterSpacing: '0.06em',
      }}>
        🔒 Secure. Confidential. Built for Dealerships. &nbsp;·&nbsp;{' '}
        <a href="mailto:support@dlr-sms.com" style={{ color: 'var(--tx-lo)', textDecoration: 'none' }}>
          support@dlr-sms.com
        </a>
      </div>

    </div>
  )
}
