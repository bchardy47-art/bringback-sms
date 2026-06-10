/**
 * DlrHeroArt — image-based hero stage for the dealer dashboard hero.
 *
 * Replaced the previous SVG-only approach with the approved cinematic truck
 * photo from /brand/dlr-truck-hero.png plus SVG lightning bolt overlays.
 * The export interface is unchanged so all import sites continue to work.
 */
export function DlrHeroArt({
  intensity = 'high',
  showTruck = true,
}: {
  intensity?: 'high' | 'low'
  showTruck?: boolean
}) {
  const boltOpacity = intensity === 'high' ? 0.7 : 0.35

  return (
    <div className="hero-stage" aria-hidden="true">
      {/* Cinematic truck photo */}
      {showTruck && <div className="hero-truck-img" />}

      {/* Lightning bolt SVG overlay */}
      <svg
        className="hero-bolts"
        viewBox="0 0 1200 480"
        preserveAspectRatio="xMaxYMid slice"
        style={{ opacity: boltOpacity }}
      >
        {/* Main bolt */}
        <path d="M820 -10 L760 150 L820 170 L700 320 L780 330 L640 510" />
        {/* Secondary fork */}
        <path d="M900 60 L880 170 L930 180 L860 290" opacity="0.85" />
        {/* Far right thin bolt */}
        <path d="M1080 -10 L1040 120 L1080 130 L1010 250" opacity="0.6" />
      </svg>

      {/* Red floor horizon glow */}
      <div className="hero-floor" />

      {/* Left-to-right vignette keeps headline readable */}
      <div className="hero-vig" />
    </div>
  )
}
