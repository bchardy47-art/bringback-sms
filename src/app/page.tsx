export const metadata = {
  title: 'DLR — Dead Lead Revival | BCHardy LLC',
  description: 'Dead Lead Revival (DLR) is an SMS re-engagement platform for automotive dealerships, operated by BCHardy LLC.',
  robots: 'index, follow',
}

const buttonBase: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  textDecoration: 'none',
  padding: '20px 24px',
  borderRadius: 10,
  fontFamily: 'system-ui, sans-serif',
  border: '1px solid transparent',
  transition: 'transform 120ms ease, box-shadow 120ms ease',
}

export default function RootPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        background: '#fafafa',
        fontFamily: 'system-ui, sans-serif',
        color: '#111',
      }}
    >
      <div style={{ width: '100%', maxWidth: 520 }}>
        <header style={{ marginBottom: 32, textAlign: 'center' }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 6px 0', letterSpacing: '-0.01em' }}>
            DLR — Dead Lead Revival
          </h1>
          <p style={{ fontSize: 14, color: '#666', margin: 0 }}>
            SMS re-engagement platform for automotive dealerships
          </p>
        </header>

        <nav
          aria-label="Sign in"
          style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}
        >
          <a
            href="/login?callbackUrl=%2Fdealer%2Fdashboard"
            style={{
              ...buttonBase,
              background: '#111',
              color: '#fff',
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 600 }}>Dealer Sign In</span>
            <span style={{ fontSize: 13, color: '#bbb', marginTop: 2 }}>
              Dealership accounts — import leads, batches, inbox
            </span>
          </a>

          <a
            href="/login?callbackUrl=%2Fdashboard"
            style={{
              ...buttonBase,
              background: '#fff',
              color: '#111',
              borderColor: '#e5e5e5',
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 600 }}>Admin / Team Sign In</span>
            <span style={{ fontSize: 13, color: '#666', marginTop: 2 }}>
              Internal team — dashboard, leads, inbox, workflows, reports
            </span>
          </a>
        </nav>

        <footer
          style={{
            display: 'flex',
            gap: 20,
            flexWrap: 'wrap',
            justifyContent: 'center',
            fontSize: 12,
            color: '#888',
          }}
        >
          <a href="/privacy" style={{ color: '#666' }}>Privacy</a>
          <a href="/terms" style={{ color: '#666' }}>Terms</a>
          <a href="/sms-terms" style={{ color: '#666' }}>SMS Terms</a>
          <span>© {new Date().getFullYear()} BCHardy LLC</span>
        </footer>
      </div>
    </main>
  )
}
