/**
 * DlrHeroArt — full-bleed SVG background used by the dealer dashboard/upload/
 * campaigns heroes. Pure SVG so we don't depend on a hosted truck/lightning
 * raster image and the file ships with the standalone bundle. Renders an
 * aggressive black-and-red garage scene: storm sky, neon grid, lightning
 * forks, road horizon, and a stylized truck silhouette on the right.
 *
 * The component is decorative — every interactive element on the hero sits
 * above this in the stacking context.
 */
export function DlrHeroArt({
  intensity = 'high',
  showTruck = true,
}: {
  intensity?: 'high' | 'low'
  showTruck?: boolean
}) {
  const lightningOpacity = intensity === 'high' ? 0.85 : 0.45
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      {/* Base radial wash */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at 78% 38%, rgba(255,27,27,0.30), transparent 38%), radial-gradient(circle at 50% 100%, rgba(255,27,27,0.14), transparent 40%), linear-gradient(180deg, #030304 0%, #08080a 55%, #030304 100%)',
        }}
      />

      {/* Electric grid overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage:
            'radial-gradient(circle at 70% 50%, rgba(0,0,0,0.95), transparent 75%)',
          WebkitMaskImage:
            'radial-gradient(circle at 70% 50%, rgba(0,0,0,0.95), transparent 75%)',
        }}
      />

      {/* Lightning forks */}
      <svg
        viewBox="0 0 1200 480"
        preserveAspectRatio="xMaxYMid slice"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: lightningOpacity,
        }}
      >
        <defs>
          <filter id="dlr-bolt-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="dlr-bolt-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff5f5" />
            <stop offset="40%" stopColor="#ff5252" />
            <stop offset="100%" stopColor="#8b0909" />
          </linearGradient>
        </defs>

        {/* Main bolt — right of center */}
        <path
          d="M820 -10 L760 150 L820 170 L700 320 L780 330 L640 510"
          stroke="url(#dlr-bolt-grad)"
          strokeWidth="3.5"
          fill="none"
          filter="url(#dlr-bolt-glow)"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Secondary fork */}
        <path
          d="M900 60 L880 170 L930 180 L860 290"
          stroke="url(#dlr-bolt-grad)"
          strokeWidth="2"
          fill="none"
          filter="url(#dlr-bolt-glow)"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.85"
        />
        {/* Far right thin bolt */}
        <path
          d="M1080 -10 L1040 120 L1080 130 L1010 250"
          stroke="url(#dlr-bolt-grad)"
          strokeWidth="1.6"
          fill="none"
          filter="url(#dlr-bolt-glow)"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.65"
        />
      </svg>

      {/* Truck silhouette */}
      {showTruck && (
        <svg
          viewBox="0 0 600 320"
          preserveAspectRatio="xMaxYMid meet"
          style={{
            position: 'absolute',
            right: '-30px',
            bottom: '0',
            height: '92%',
            width: 'auto',
            opacity: 0.95,
          }}
        >
          <defs>
            <linearGradient id="dlr-truck-body" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1a1a1d" />
              <stop offset="55%" stopColor="#0a0a0c" />
              <stop offset="100%" stopColor="#030304" />
            </linearGradient>
            <linearGradient id="dlr-truck-rim" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ff2929" />
              <stop offset="100%" stopColor="#8b0909" />
            </linearGradient>
            <radialGradient id="dlr-headlight" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0%" stopColor="#fff" stopOpacity="1" />
              <stop offset="60%" stopColor="#ffb3b3" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#ff1b1b" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Ground shadow */}
          <ellipse cx="300" cy="295" rx="280" ry="12" fill="#000" opacity="0.65" />

          {/* Cab */}
          <path
            d="M40 220 L60 140 L210 130 L240 90 L370 90 L390 180 L560 200 L560 260 L40 260 Z"
            fill="url(#dlr-truck-body)"
            stroke="url(#dlr-truck-rim)"
            strokeWidth="2"
          />
          {/* Windshield */}
          <path
            d="M225 145 L245 105 L355 105 L375 175 L235 175 Z"
            fill="#0c0c10"
            stroke="rgba(255,27,27,0.45)"
            strokeWidth="1.5"
          />
          <path
            d="M250 110 L345 110 L362 168 L255 168 Z"
            fill="#1a0808"
            opacity="0.85"
          />
          {/* Side reflection */}
          <path
            d="M70 230 L80 165 L200 158 L210 230 Z"
            fill="#0a0a0c"
            stroke="rgba(255,27,27,0.18)"
            strokeWidth="1"
          />
          {/* Grille / red bar */}
          <rect x="380" y="200" width="170" height="6" fill="#ff1b1b" opacity="0.85" />
          <rect x="380" y="212" width="170" height="3" fill="#ff5252" opacity="0.6" />

          {/* Headlight */}
          <circle cx="540" cy="225" r="32" fill="url(#dlr-headlight)" />
          <circle cx="540" cy="225" r="8" fill="#fff" />

          {/* Wheels */}
          <circle cx="120" cy="265" r="38" fill="#050505" stroke="#1a1a1d" strokeWidth="2" />
          <circle cx="120" cy="265" r="22" fill="#0a0a0c" stroke="url(#dlr-truck-rim)" strokeWidth="2" />
          <circle cx="120" cy="265" r="6" fill="#ff1b1b" />

          <circle cx="430" cy="265" r="38" fill="#050505" stroke="#1a1a1d" strokeWidth="2" />
          <circle cx="430" cy="265" r="22" fill="#0a0a0c" stroke="url(#dlr-truck-rim)" strokeWidth="2" />
          <circle cx="430" cy="265" r="6" fill="#ff1b1b" />

          {/* Under-glow */}
          <ellipse cx="270" cy="282" rx="220" ry="6" fill="#ff1b1b" opacity="0.55" />
        </svg>
      )}

      {/* Left-side fade so the headline always remains readable */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(90deg, rgba(3,3,4,0.96) 0%, rgba(3,3,4,0.78) 38%, rgba(3,3,4,0.32) 70%, transparent 100%)',
        }}
      />

      {/* Bottom horizon line */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 2,
          background:
            'linear-gradient(90deg, transparent, rgba(255,27,27,0.85), transparent)',
          boxShadow: '0 0 16px rgba(255,27,27,0.55)',
        }}
      />
    </div>
  )
}
