'use client'

type FunnelStep = {
  label: string
  sublabel: string
  value: number | string
  pct?: string
  color: string
}

export function FunnelViz({ steps }: { steps: FunnelStep[] }) {
  const viewW = 280
  const stepH = 64
  const gap = 3
  const minW = 40
  const maxW = viewW
  const totalH = steps.length * stepH + (steps.length - 1) * gap

  return (
    <div>
      {/* Full-width responsive SVG funnel */}
      <svg
        viewBox={`0 0 ${viewW} ${totalH}`}
        style={{ width: '100%', display: 'block' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        {steps.map((step, i) => {
          const frac = i / steps.length
          const fracNext = (i + 1) / steps.length
          const topW = maxW - frac * (maxW - minW)
          const botW = maxW - fracNext * (maxW - minW)
          const topL = (viewW - topW) / 2
          const botL = (viewW - botW) / 2
          const y = i * (stepH + gap)
          const pts = `${topL},${y + 1} ${topL + topW},${y + 1} ${botL + botW},${y + stepH - 1} ${botL},${y + stepH - 1}`
          const midY = y + stepH / 2

          return (
            <g key={i}>
              <polygon points={pts} fill={step.color} opacity={0.93} />
              {/* White divider between stages */}
              {i > 0 && (
                <line
                  x1={topL} y1={y + 1}
                  x2={topL + topW} y2={y + 1}
                  stroke="white" strokeWidth="2"
                />
              )}
              {/* Value label centred inside */}
              <text
                x={viewW / 2} y={midY + 1}
                textAnchor="middle" dominantBaseline="middle"
                fill="white" fontSize="15" fontWeight="700"
                fontFamily="system-ui, sans-serif"
              >
                {typeof step.value === 'number' ? step.value.toLocaleString() : step.value}
                {step.pct ? `  ·  ${step.pct}` : ''}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Legend rows below funnel */}
      <div className="mt-4 space-y-2">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                style={{ backgroundColor: step.color }}
              />
              <span className="text-xs text-gray-600 truncate">{step.label}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
              {step.pct && (
                <span className="text-xs text-gray-400">{step.pct}</span>
              )}
              <span className="text-sm font-bold text-gray-900">
                {typeof step.value === 'number' ? step.value.toLocaleString() : step.value}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
