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

export function verdict(ghostName: string, ghostMs: number, runMs: number): string {
  const margin = formatSeconds(Math.abs(ghostMs - runMs))
  if (runMs < ghostMs) return `YOU BEAT ${displayName(ghostName)} BY ${margin}`
  if (runMs > ghostMs) return `${displayName(ghostName)} BEAT YOU BY ${margin}`
  return `DEAD HEAT WITH ${displayName(ghostName)}`
}

export function flowControlPercent(metrics: Readonly<relayLeg.Metrics>, ticks: number): number {
  if (ticks <= 0) return 0
  return Math.round((metrics.flowSum / (ticks * 65536)) * 100)
}
