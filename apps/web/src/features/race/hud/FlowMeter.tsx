import { FLOW_HIGH, FLOW_MID, type FlowTier } from '../flow-tier'

interface FlowMeterProps {
  /** 0..1 */
  flow: number
  tier: FlowTier
  /** Share of the current Relay Rush still to run, 0..1, or null outside a rush. */
  rush: number | null
}

const RADIUS = 96
const START = (208 * Math.PI) / 180
const END = (332 * Math.PI) / 180

function point(angle: number): string {
  return `${(120 + Math.cos(angle) * RADIUS).toFixed(2)} ${(120 - Math.sin(angle) * RADIUS).toFixed(2)}`
}

const ARC = `M ${point(START)} A ${RADIUS} ${RADIUS} 0 0 0 ${point(END)}`
const LENGTH = RADIUS * (END - START)
/** Tier marks on the arc, where mid and high begin. */
const MARKS = [FLOW_MID, FLOW_HIGH].map(share => {
  const angle = START + (END - START) * share
  const inner = RADIUS - 5
  const outer = RADIUS + 5
  return {
    share,
    d: `M ${(120 + Math.cos(angle) * inner).toFixed(2)} ${(120 - Math.sin(angle) * inner).toFixed(2)} L ${(120 + Math.cos(angle) * outer).toFixed(2)} ${(120 - Math.sin(angle) * outer).toFixed(2)}`,
  }
})

/**
 * A luminous arc hugging the courier. FLOW fills it gold; each tier thickens and warms it, high FLOW
 * breathes, and Relay Rush turns it white-gold with a badge that drains as the rush runs out.
 */
export function FlowMeter({ flow, tier, rush }: FlowMeterProps) {
  const clamped = Math.max(0, Math.min(1, flow))
  return (
    <div className="leg-flow" data-tier={tier} role="meter" aria-label={tier === 'rush' ? 'Flow, Relay Rush' : 'Flow'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped * 100)}>
      <svg viewBox="0 0 240 240" aria-hidden="true">
        <defs>
          <linearGradient id="leg-flow-gradient" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#e8890a" />
            <stop offset="0.6" stopColor="#f5a623" />
            <stop offset="1" stopColor="#ffe3a6" />
          </linearGradient>
        </defs>
        <path className="leg-flow__track" d={ARC} />
        {MARKS.map(mark => (
          <path key={mark.share} className="leg-flow__mark" data-lit={clamped >= mark.share ? 'true' : 'false'} d={mark.d} />
        ))}
        <path className="leg-flow__fill" d={ARC} style={{ strokeDasharray: `${LENGTH * clamped} ${LENGTH}` }} />
      </svg>
      <span className="leg-flow__label">FLOW</span>
      {rush !== null && (
        <div className="leg-rush" role="status">
          <span className="leg-rush__label">RELAY RUSH</span>
          <span className="leg-rush__bar">
            <span className="leg-rush__fill" style={{ transform: `scaleX(${Math.max(0, Math.min(1, rush))})` }} />
          </span>
        </div>
      )}
    </div>
  )
}
