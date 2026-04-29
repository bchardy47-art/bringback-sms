export function ManufacturerLogo({
  manufacturer,
  size = 48,
}: {
  manufacturer: string
  size?: number
}) {
  const m = manufacturer.toLowerCase()

  if (m === 'ford') return <FordLogo size={size} />
  if (m === 'toyota') return <ToyotaLogo size={size} />
  if (m === 'bmw') return <BmwLogo size={size} />
  if (m === 'chevrolet') return <ChevroletLogo size={size} />
  if (m === 'honda') return <HondaLogo size={size} />
  if (m === 'lincoln') return <LincolnLogo size={size} />
  return null
}

function FordLogo({ size }: { size: number }) {
  const h = Math.round(size * 0.55)
  return (
    <svg width={size} height={h} viewBox="0 0 120 66" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="60" cy="33" rx="58" ry="31" fill="#003476" stroke="#003476" strokeWidth="1"/>
      <ellipse cx="60" cy="33" rx="53" ry="26" fill="none" stroke="#7eaee3" strokeWidth="1.5"/>
      <text x="60" y="40" textAnchor="middle" fill="white" fontFamily="sans-serif" fontWeight="bold" fontSize="26" letterSpacing="1">FORD</text>
    </svg>
  )
}

function LincolnLogo({ size }: { size: number }) {
  const s = size * 0.9
  return (
    <svg width={s} height={s} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="4" fill="#0a0a0a"/>
      {/* Lincoln star cross */}
      <line x1="50" y1="8" x2="50" y2="92" stroke="#c8a96e" strokeWidth="4"/>
      <line x1="8" y1="50" x2="92" y2="50" stroke="#c8a96e" strokeWidth="4"/>
      <line x1="19" y1="19" x2="81" y2="81" stroke="#c8a96e" strokeWidth="2.5"/>
      <line x1="81" y1="19" x2="19" y2="81" stroke="#c8a96e" strokeWidth="2.5"/>
      <circle cx="50" cy="50" r="12" fill="#c8a96e"/>
    </svg>
  )
}

function ToyotaLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="48" fill="#eb0a1e"/>
      {/* Toyota ellipses */}
      <ellipse cx="50" cy="50" rx="20" ry="30" fill="none" stroke="white" strokeWidth="5"/>
      <ellipse cx="50" cy="50" rx="38" ry="18" fill="none" stroke="white" strokeWidth="5"/>
      <ellipse cx="50" cy="50" rx="46" ry="12" fill="none" stroke="white" strokeWidth="3"/>
    </svg>
  )
}

function BmwLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="48" fill="white" stroke="#1c1c1c" strokeWidth="2"/>
      <circle cx="50" cy="50" r="36" fill="none" stroke="#1c1c1c" strokeWidth="4"/>
      {/* Quadrants */}
      <path d="M50 14 A36 36 0 0 1 86 50 L50 50 Z" fill="#0066cc"/>
      <path d="M14 50 A36 36 0 0 1 50 14 L50 50 Z" fill="white"/>
      <path d="M50 86 A36 36 0 0 1 14 50 L50 50 Z" fill="#0066cc"/>
      <path d="M86 50 A36 36 0 0 1 50 86 L50 50 Z" fill="white"/>
      <circle cx="50" cy="50" r="36" fill="none" stroke="#1c1c1c" strokeWidth="4"/>
      <line x1="50" y1="14" x2="50" y2="86" stroke="#1c1c1c" strokeWidth="3"/>
      <line x1="14" y1="50" x2="86" y2="50" stroke="#1c1c1c" strokeWidth="3"/>
      <text x="50" y="93" textAnchor="middle" fill="#1c1c1c" fontFamily="sans-serif" fontWeight="900" fontSize="8" letterSpacing="2">BMW</text>
    </svg>
  )
}

function ChevroletLogo({ size }: { size: number }) {
  const h = Math.round(size * 0.55)
  return (
    <svg width={size} height={h} viewBox="0 0 120 66" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Chevy bowtie */}
      <polygon points="0,18 38,18 50,2 82,2 82,18 120,18 120,48 82,48 70,64 38,64 38,48 0,48" fill="#d4af37"/>
      <polygon points="6,22 38,22 50,8 76,8 76,22 114,22 114,44 76,44 64,58 44,58 44,44 6,44" fill="#1a1a1a"/>
      <polygon points="44,22 62,22 50,8 76,8 76,44 58,44 70,58 44,58 44,44 44,44" fill="#1a1a1a"/>
    </svg>
  )
}

function HondaLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="48" fill="#cc0000"/>
      {/* H mark */}
      <text x="50" y="67" textAnchor="middle" fill="white" fontFamily="sans-serif" fontWeight="900" fontSize="58" letterSpacing="-2">H</text>
    </svg>
  )
}
