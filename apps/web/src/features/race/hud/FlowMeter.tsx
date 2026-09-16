interface FlowMeterProps {
  /** 0..1 */
  flow: number
}

const RADIUS = 96
const START = (208 * Math.PI) / 180
const END = (332 * Math.PI) / 180

function point(angle: number): string {
  return `${(120 + Math.cos(angle) * RADIUS).toFixed(2)} ${(120 - Math.sin(angle) * RADIUS).toFixed(2)}`
}

const ARC = `M ${point(START)} A ${RADIUS} ${RADIUS} 0 0 0 ${point(END)}`
const LENGTH = RADIUS * (END - START)

/** A luminous arc hugging the courier: FLOW fills it gold and it breathes when full. */
export function FlowMeter({ flow }: FlowMeterProps) {
  const clamped = Math.max(0, Math.min(1, flow))
  const full = clamped >= 0.995
  return (
    <div className="leg-flow" data-full={full ? 'true' : 'false'} role="meter" aria-label="Flow" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped * 100)}>
      <svg viewBox="0 0 240 240" aria-hidden="true">
        <defs>
          <linearGradient id="leg-flow-gradient" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#e8890a" />
            <stop offset="0.6" stopColor="#f5a623" />
            <stop offset="1" stopColor="#ffe3a6" />
          </linearGradient>
        </defs>
        <path className="leg-flow__track" d={ARC} />
        <path className="leg-flow__fill" d={ARC} style={{ strokeDasharray: `${LENGTH * clamped} ${LENGTH}` }} />
      </svg>
      <span className="leg-flow__label">FLOW</span>
    </div>
  )
}
