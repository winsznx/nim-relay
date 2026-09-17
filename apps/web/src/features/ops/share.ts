import type { CSSProperties } from 'react'

export function percentOf(count: number, whole: number): string {
  return whole === 0 ? '0%' : `${Math.round((count / whole) * 100)}%`
}

/** Fills an `.nr-ops-track` bar to `part` of `whole`, capped at full. */
export function shareStyle(part: number, whole: number): CSSProperties {
  return { '--nr-ops-share': whole > 0 ? Math.min(1, part / whole) : 0 } as CSSProperties
}
