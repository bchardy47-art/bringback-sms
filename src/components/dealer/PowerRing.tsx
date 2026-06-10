export function PowerRing({
  value = 87,
  size = 132,
}: {
  value?: number
  size?: number
}) {
  const r = size / 2 - 10
  const c = 2 * Math.PI * r
  const dash = (value / 100) * c

  return (
    <div
      className="ring-wrap"
      style={{ width: size, height: size, margin: '0 auto', position: 'relative' }}
    >
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="7"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#pg)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          style={{ filter: 'drop-shadow(0 0 6px var(--red-glow))' }}
        />
        <defs>
          <linearGradient id="pg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff5a1f" />
            <stop offset="1" stopColor="#ff2a2a" />
          </linearGradient>
        </defs>
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
        }}
      >
        <div className="stat-num" style={{ fontSize: size * 0.27 }}>
          {value}%
        </div>
      </div>
    </div>
  )
}
