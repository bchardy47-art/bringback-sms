export function EKG({ height = 40 }: { height?: number }) {
  const d =
    'M0 20 H120 l8 -14 l8 28 l7 -36 l9 44 l8 -22 H230 l6 -10 l7 20 l6 -10 H500 l8 -14 l8 28 l7 -30 l9 32 l8 -16 H900 l6 -12 l7 24 l6 -12 H1460'

  return (
    <svg
      className="ekg"
      viewBox="0 0 1460 40"
      preserveAspectRatio="none"
      style={{ height, width: '100%', display: 'block' }}
    >
      <path className="base" d={d} />
      <path className="lead" d={d} />
    </svg>
  )
}
