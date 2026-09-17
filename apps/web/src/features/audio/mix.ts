import { FLOW_HIGH, FLOW_MID } from '../race/flow-tier'

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

/**
 * Relay Rush pins FLOW at full; the music goes past full FLOW for it: brighter, wider, every
 * layer in and more wind rushing past.
 */
const RUSH_MIX: FlowMix = { lowpassHz: LOWPASS_OPEN_HZ, brightnessDb: 5, hatGain: 1, width: 1.45, windBoost: 0.3 }

export function flowMix(flow: number, rush = false): FlowMix {
  if (rush) return RUSH_MIX
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

/** FLOW must fall this far below a tier's start before climbing back into it announces again. */
export const FLOW_RISE_HYSTERESIS = 0.06

function tierOf(flow: number, offset: number): number {
  return flow >= FLOW_HIGH - offset ? 2 : flow >= FLOW_MID - offset ? 1 : 0
}

/**
 * Hears FLOW climb into the race's mid and high tiers, once per climb, so the rise can sound at the
 * same moment the HUD and the scene brighten. The first reading of a race only sets the starting
 * tier; riding a boundary stays quiet.
 */
export class FlowRise {
  private tier = 0
  private primed = false

  /** Returns true when `flow` has just reached a higher tier. */
  update(flow: number): boolean {
    const f = unit(flow)
    const reached = tierOf(f, 0)
    if (!this.primed) {
      this.primed = true
      this.tier = reached
      return false
    }
    if (reached > this.tier) {
      this.tier = reached
      return true
    }
    this.tier = Math.min(this.tier, tierOf(f, FLOW_RISE_HYSTERESIS))
    return false
  }

  reset(): void {
    this.primed = false
    this.tier = 0
  }
}
