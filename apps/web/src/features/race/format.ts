import type { relayLeg } from '@nim-relay/game-engine'

/** Player-facing copy for the race HUD and results. */

export function formatSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(2)}s`
}

export function displayName(name: string): string {
  const trimmed = name.trim()
  return (trimmed.length > 0 ? trimmed : 'Runner').toUpperCase()
}

/** "TIM’S", "MARCUS’" */
export function possessive(name: string): string {
  const upper = displayName(name)
  return upper.endsWith('S') ? `${upper}’` : `${upper}’S`
}

export interface DeltaChip {
  label: string
  value: string
  leader: 'you' | 'ghost'
}

/** `delta` is seconds the ghost is ahead; negative when the courier leads. */
export function deltaChip(ghostName: string, delta: number): DeltaChip {
  const leader = delta >= 0 ? 'ghost' : 'you'
  return {
    label: leader === 'ghost' ? displayName(ghostName) : 'YOU',
    value: `+${Math.abs(delta).toFixed(2)}`,
    leader,
  }
}

/**
 * The gap to the previous runner as a split: "−0.18s" when the courier leads, "+0.31s" when the
 * ghost does. `delta` is seconds the ghost is ahead.
 */
export function ghostGap(delta: number): string {
  const rounded = Math.round(delta * 100) / 100
  if (rounded === 0) return '0.00s'
  return `${rounded < 0 ? '−' : '+'}${Math.abs(rounded).toFixed(2)}s`
}

/** The line under the relay bar: "62% · −0.18s", or "62%" without a ghost. */
export function routeReadout(progress: number, delta: number | null): string {
  const percent = `${Math.floor(Math.max(0, Math.min(1, progress)) * 100)}%`
  return delta === null ? percent : `${percent} · ${ghostGap(delta)}`
}

export function verdict(ghostName: string, ghostMs: number, runMs: number): string {
  const margin = formatSeconds(Math.abs(ghostMs - runMs))
  if (runMs < ghostMs) return `YOU BEAT ${displayName(ghostName)} BY ${margin}`
  if (runMs > ghostMs) return `${displayName(ghostName)} BEAT YOU BY ${margin}`
  return `DEAD HEAT WITH ${displayName(ghostName)}`
}

/** Average FLOW over a leg. Only `flowSum` is read, so v5 and v6 metrics both work. */
export function flowControlPercent(metrics: Readonly<Pick<relayLeg.Metrics, 'flowSum'>>, ticks: number): number {
  if (ticks <= 0) return 0
  return Math.round((metrics.flowSum / (ticks * 65536)) * 100)
}
