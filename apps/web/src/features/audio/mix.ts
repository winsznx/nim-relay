/**
 * Continuous mix curves for the race: what FLOW and speed do to the music and the ride.
 * Inputs are clamped to 0..1; outputs are targets the director glides toward.
 */

export interface FlowMix {
  /** Music low-pass cutoff. Low FLOW hears the track through a wall; mid FLOW opens it fully. */
  lowpassHz: number
  /** High-shelf lift on the music at high FLOW. */
  brightnessDb: number
  /** Gain of the synthesized hat layer on the 144 BPM grid. */
  hatGain: number
  /** Stereo width of the music (1 = as mixed). */
  width: number
  /** Extra wind on top of the speed-driven level (low FLOW sounds exposed). */
  windBoost: number
}

export interface SpeedMix {
  windGain: number
  windRate: number
  hoverGain: number
  hoverRate: number
}

export const LOWPASS_CLOSED_HZ = 700
export const LOWPASS_OPEN_HZ = 20000
/** FLOW at which the music filter is fully open. */
const FLOW_OPEN = 0.5

function unit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

/** Hermite ease between `from` and `to`: 0 below, 1 above. */
function smoothstep(from: number, to: number, value: number): number {
  const t = unit((value - from) / (to - from))
  return t * t * (3 - 2 * t)
}

export function flowMix(flow: number): FlowMix {
  const f = unit(flow)
  const opening = Math.min(1, f / FLOW_OPEN)
  const lowpassHz = opening >= 1 ? LOWPASS_OPEN_HZ : LOWPASS_CLOSED_HZ * (18000 / LOWPASS_CLOSED_HZ) ** opening
  return {
    lowpassHz,
    brightnessDb: 3 * smoothstep(0.75, 1, f),
    hatGain: smoothstep(0.7, 0.95, f),
    width: 1 + 0.3 * smoothstep(0.8, 1, f),
    windBoost: 0.35 * (1 - smoothstep(0, FLOW_OPEN, f)),
  }
}

export function speedMix(speed: number): SpeedMix {
  const s = unit(speed)
  return {
    windGain: 0.08 + 0.55 * s ** 1.5,
    windRate: 0.8 + 0.45 * s,
    hoverGain: 0.5 + 0.5 * s,
    hoverRate: 0.75 + 0.55 * s,
  }
}
