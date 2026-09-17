import { relayLeg } from '@nim-relay/game-engine'
import type { HapticKind } from './haptics'
import type { SynthSoundId } from './synth'
import type { SoundId } from './tracks'

/**
 * What every gameplay and UI moment sounds like, and how often it may sound. The engine emits
 * events as bit flags per tick (relayLeg.EVENT); `eventCues` turns a mask into cue names and
 * `CueGate` enforces per-cue rate limits. Nothing here touches Web Audio.
 */

export type EventCue =
  | 'perfect-gate'
  | 'missed-gate'
  | 'pulse-hit'
  | 'near-miss'
  | 'hit'
  | 'jump'
  | 'land'
  | 'clean-land'
  | 'slide'
  | 'rail-on'
  | 'rail-off'
  | 'boost-pad'
  | 'fork-safe'
  | 'fork-risk'
  | 'risk-clear'
  | 'fall'
  | 'flow-max'
  | 'finish'
  | 'lane-shift'
  | 'lane-acquired'
  | 'shoulder'
  | 'edge-grind'
  | 'edge-save'
  | 'tether-save'
  | 'leg-failed'
  | 'ghost-overtake'
  | 'ghost-overtaken'
  | 'drafting'
  | 'rush-start'
  | 'hard-landing'
  | 'world-event'

export type NamedCue =
  | 'overtake'
  | 'overtaken'
  | 'approach'
  | 'finish-win'
  | 'finish-lose'
  | 'ui-tap'
  | 'ui-back'
  | 'ui-error'
  | 'wallet-open'
  | 'wallet-paused'
  | 'handoff-in-flight'
  | 'handoff-confirmed'
  | 'arrival'
  | 'incoming'
  | 'catch'
  | 'flow-rise'
  | 'baton-separate'

export type CueName = EventCue | NamedCue

/** A shipped sample, or a sound synthesized in code on first use (see synth.ts). */
export type CueSound = SoundId | SynthSoundId

export interface CueSpec {
  /** One of these plays, picked at random. */
  readonly variants: readonly CueSound[]
  /** Played together with the chosen variant. */
  readonly layers: readonly CueSound[]
  readonly gain: number
  readonly rate: number
  /** Playback rate varies randomly by up to ± this fraction, so repeats don't sound stamped. */
  readonly pitchSpread: number
  /** Seconds; see `retrigger`. */
  readonly minInterval: number
  /**
   * interval: at most once per `minInterval`.
   * edge: the engine repeats some events every tick (a boost pad); play when the event starts and
   * again only after it has been absent for `minInterval`.
   */
  readonly retrigger: 'interval' | 'edge'
  /** alternate: successive plays swing left and right. */
  readonly pan: 'center' | 'alternate'
  /** Music dips to `depth` (linear gain) and recovers after `seconds`. */
  readonly duck: { readonly depth: number; readonly seconds: number } | null
  readonly haptic: HapticKind | null
  /** ui sounds bypass the race and ceremony processing. */
  readonly bus: 'sfx' | 'ui'
}

const BASE: CueSpec = {
  variants: [],
  layers: [],
  gain: 0.5,
  rate: 1,
  pitchSpread: 0.03,
  minInterval: 0.1,
  retrigger: 'interval',
  pan: 'center',
  duck: null,
  haptic: null,
  bus: 'sfx',
}

const cue = (variant: CueSound | readonly CueSound[], spec: Partial<CueSpec> = {}): CueSpec => ({
  ...BASE,
  variants: typeof variant === 'string' ? [variant] : variant,
  ...spec,
})

const ui = (variant: SoundId, spec: Partial<CueSpec> = {}): CueSpec => cue(variant, { bus: 'ui', pitchSpread: 0, gain: 0.4, minInterval: 0.05, ...spec })

export const CUES: Readonly<Record<CueName, CueSpec>> = {
  'perfect-gate': cue('gate-perfect', { gain: 0.55, minInterval: 0.08, haptic: 'tick' }),
  'missed-gate': cue('gate-miss', { gain: 0.45, rate: 0.92, pitchSpread: 0.02, minInterval: 0.15 }),
  // Pulse gates land on the beat; a steady pitch keeps them part of the music.
  'pulse-hit': cue('pulse-hit', { gain: 0.7, pitchSpread: 0, haptic: 'tick' }),
  'near-miss': cue(['near-miss-a', 'near-miss-b'], { gain: 0.6, pitchSpread: 0.08, minInterval: 0.12, pan: 'alternate' }),
  hit: cue(['hit-a', 'hit-b'], { gain: 0.9, pitchSpread: 0.06, minInterval: 0.25, duck: { depth: 0.45, seconds: 0.35 }, haptic: 'impact' }),
  jump: cue('jump', { gain: 0.5, pitchSpread: 0.06, minInterval: 0.12 }),
  land: cue('land', { gain: 0.5, pitchSpread: 0.06, minInterval: 0.12 }),
  'clean-land': cue('clean-land', { layers: ['land'], gain: 0.55, pitchSpread: 0.02, minInterval: 0.12, haptic: 'tick' }),
  slide: cue('slide', { gain: 0.45, rate: 0.9, pitchSpread: 0.05, minInterval: 0.15 }),
  'rail-on': cue('rail-on', { gain: 0.5, pitchSpread: 0.05, haptic: 'tick' }),
  'rail-off': cue('rail-off', { gain: 0.35, pitchSpread: 0.05 }),
  'boost-pad': cue('boost', { gain: 0.6, minInterval: 0.25, retrigger: 'edge', haptic: 'tick' }),
  'fork-safe': cue('fork-safe', { gain: 0.45, pitchSpread: 0, minInterval: 1 }),
  'fork-risk': cue('fork-risk', { gain: 0.55, pitchSpread: 0, minInterval: 1 }),
  'risk-clear': cue('risk-clear', { gain: 0.6, pitchSpread: 0, minInterval: 1, haptic: 'success' }),
  fall: cue('fall-whoosh', { layers: ['fall-boom'], gain: 0.85, pitchSpread: 0.04, minInterval: 0.5, duck: { depth: 0.3, seconds: 0.8 }, haptic: 'heavy' }),
  'flow-max': cue('flow-max', { gain: 0.6, pitchSpread: 0, minInterval: 2, haptic: 'success' }),
  finish: cue('finish', { gain: 0.8, pitchSpread: 0, minInterval: 2, haptic: 'success' }),
  // Lanes are the courier's language: a swish out, a dry click when the new lane is held.
  'lane-shift': cue('synth-lane-shift', { gain: 0.3, pitchSpread: 0.08, minInterval: 0.06 }),
  'lane-acquired': cue('synth-lane-tick', { gain: 0.2, pitchSpread: 0.05, minInterval: 0.05 }),
  // The engine may raise these every tick they last; edge retriggering plays each stretch once.
  shoulder: cue('synth-shoulder', { gain: 0.5, pitchSpread: 0.04, minInterval: 0.5, retrigger: 'edge', haptic: 'warning' }),
  'edge-grind': cue('rail-on', { layers: ['hit-b'], gain: 0.55, rate: 0.85, pitchSpread: 0.05, minInterval: 0.4, retrigger: 'edge', haptic: 'impact' }),
  drafting: cue('synth-draft', { gain: 0.26, pitchSpread: 0.03, minInterval: 1.5, retrigger: 'edge' }),
  'edge-save': cue('risk-clear', { layers: ['clean-land'], gain: 0.6, rate: 1.08, pitchSpread: 0, minInterval: 0.6, haptic: 'success' }),
  'tether-save': cue('synth-tether', { layers: ['catch'], gain: 0.8, pitchSpread: 0, minInterval: 1, duck: { depth: 0.4, seconds: 0.9 }, haptic: 'launch' }),
  'leg-failed': cue('synth-failed', { layers: ['fall-boom'], gain: 0.8, pitchSpread: 0, minInterval: 2, duck: { depth: 0.2, seconds: 2.2 }, haptic: 'heavy' }),
  'ghost-overtake': cue('overtake', { layers: ['near-miss-b'], gain: 0.55, pitchSpread: 0.02, minInterval: 0.8, haptic: 'tick' }),
  'ghost-overtaken': cue('overtaken', { gain: 0.45, pitchSpread: 0.02, minInterval: 0.8 }),
  'rush-start': cue('synth-rush', { layers: ['flow-max'], gain: 0.85, pitchSpread: 0, minInterval: 2, duck: { depth: 0.55, seconds: 0.35 }, haptic: 'launch' }),
  'hard-landing': cue('land', { layers: ['hit-b'], gain: 0.7, rate: 0.85, pitchSpread: 0.04, minInterval: 0.2, haptic: 'impact' }),
  'world-event': cue('approach', { gain: 0.45, rate: 0.8, pitchSpread: 0, minInterval: 1.2 }),

  overtake: cue('overtake', { layers: ['near-miss-b'], gain: 0.55, pitchSpread: 0.02, minInterval: 0.8, haptic: 'tick' }),
  overtaken: cue('overtaken', { gain: 0.45, pitchSpread: 0.02, minInterval: 0.8 }),
  approach: cue('approach', { gain: 0.5, pitchSpread: 0, minInterval: 3 }),
  'finish-win': cue('finish-win', { gain: 0.75, pitchSpread: 0, minInterval: 3, duck: { depth: 0.35, seconds: 3.5 }, haptic: 'success' }),
  'finish-lose': cue('finish-lose', { gain: 0.6, pitchSpread: 0, minInterval: 3, duck: { depth: 0.5, seconds: 1.2 } }),
  catch: cue('catch', { layers: ['land'], gain: 0.6, pitchSpread: 0, minInterval: 0.5, haptic: 'tick' }),
  'flow-rise': cue('synth-flow-rise', { gain: 0.32, pitchSpread: 0, minInterval: 0.8 }),
  'baton-separate': cue('synth-baton-lift', { layers: ['catch'], gain: 0.55, pitchSpread: 0, minInterval: 1, haptic: 'tick' }),

  'ui-tap': ui('ui-tap', { gain: 0.35, pitchSpread: 0.04, minInterval: 0.03 }),
  'ui-back': ui('ui-back', { gain: 0.35 }),
  'ui-error': ui('ui-error', { gain: 0.45, minInterval: 0.3, haptic: 'warning' }),
  'wallet-open': ui('wallet-open', { gain: 0.45, minInterval: 0.5 }),
  'wallet-paused': ui('wallet-paused', { gain: 0.45, minInterval: 0.5 }),
  'handoff-in-flight': ui('handoff-in-flight', { gain: 0.5, minInterval: 1 }),
  'handoff-confirmed': ui('handoff-confirmed', { gain: 0.6, minInterval: 1, haptic: 'success' }),
  arrival: ui('arrival', { gain: 0.6, minInterval: 1, haptic: 'success' }),
  incoming: ui('incoming', { gain: 0.5, minInterval: 1, haptic: 'notify' }),
}

/** Engine event bits in the order their cues are played. */
export const EVENT_CUES: readonly (readonly [bit: number, cue: EventCue])[] = [
  [relayLeg.EVENT.FINISH, 'finish'],
  [relayLeg.EVENT.LEG_FAILED, 'leg-failed'],
  [relayLeg.EVENT.TETHER_SAVE, 'tether-save'],
  [relayLeg.EVENT.FALL, 'fall'],
  [relayLeg.EVENT.RUSH_START, 'rush-start'],
  [relayLeg.EVENT.EDGE_SAVE, 'edge-save'],
  [relayLeg.EVENT.HIT, 'hit'],
  [relayLeg.EVENT.EDGE_GRIND, 'edge-grind'],
  [relayLeg.EVENT.GHOST_OVERTAKE, 'ghost-overtake'],
  [relayLeg.EVENT.GHOST_OVERTAKEN, 'ghost-overtaken'],
  [relayLeg.EVENT.HARD_LANDING, 'hard-landing'],
  [relayLeg.EVENT.PULSE_HIT, 'pulse-hit'],
  [relayLeg.EVENT.PERFECT_GATE, 'perfect-gate'],
  [relayLeg.EVENT.MISSED_GATE, 'missed-gate'],
  [relayLeg.EVENT.RISK_CLEAR, 'risk-clear'],
  [relayLeg.EVENT.FLOW_MAX, 'flow-max'],
  [relayLeg.EVENT.FORK_RISK, 'fork-risk'],
  [relayLeg.EVENT.FORK_SAFE, 'fork-safe'],
  [relayLeg.EVENT.NEAR_MISS, 'near-miss'],
  [relayLeg.EVENT.CLEAN_LAND, 'clean-land'],
  [relayLeg.EVENT.LAND, 'land'],
  [relayLeg.EVENT.JUMP, 'jump'],
  [relayLeg.EVENT.SLIDE, 'slide'],
  [relayLeg.EVENT.RAIL_ON, 'rail-on'],
  [relayLeg.EVENT.RAIL_OFF, 'rail-off'],
  [relayLeg.EVENT.BOOST_PAD, 'boost-pad'],
  [relayLeg.EVENT.EVENT_TRIGGERED, 'world-event'],
  [relayLeg.EVENT.SHOULDER, 'shoulder'],
  [relayLeg.EVENT.LANE_SHIFT, 'lane-shift'],
  [relayLeg.EVENT.LANE_ACQUIRED, 'lane-acquired'],
  [relayLeg.EVENT.DRAFTING, 'drafting'],
]

/**
 * Events the engine raises together where one sound already says it all: a pulse gate is also a
 * perfect gate, a clean landing is also a landing, a fall swallows the hit or landing that caused
 * it, and a failed leg or a tether save speaks over the fall around it.
 */
const SUPERSEDES: Partial<Record<EventCue, readonly EventCue[]>> = {
  'pulse-hit': ['perfect-gate'],
  'clean-land': ['land'],
  'hard-landing': ['land', 'clean-land'],
  fall: ['hit', 'land', 'hard-landing', 'near-miss', 'edge-grind', 'shoulder', 'lane-shift', 'lane-acquired'],
  'leg-failed': ['fall', 'hit', 'land', 'hard-landing', 'near-miss', 'edge-grind', 'shoulder', 'lane-shift', 'lane-acquired'],
  'tether-save': ['land', 'hard-landing', 'lane-acquired'],
  'edge-save': ['lane-shift', 'lane-acquired', 'edge-grind'],
  'rush-start': ['flow-max'],
}

export function eventCues(mask: number): EventCue[] {
  const raised = EVENT_CUES.filter(([bit]) => (mask & bit) !== 0).map(([, name]) => name)
  const hidden = new Set(raised.flatMap(name => SUPERSEDES[name] ?? []))
  return raised.filter(name => !hidden.has(name))
}

/** Per-cue rate limiting. `now` is any monotonic clock in seconds. */
export class CueGate {
  private readonly lastPlayed = new Map<CueName, number>()
  private readonly lastSeen = new Map<CueName, number>()

  allow(name: CueName, now: number): boolean {
    const spec = CUES[name]
    if (spec.retrigger === 'edge') {
      const seen = this.lastSeen.get(name)
      this.lastSeen.set(name, now)
      return seen === undefined || now - seen > spec.minInterval
    }
    const played = this.lastPlayed.get(name)
    if (played !== undefined && now - played < spec.minInterval) return false
    this.lastPlayed.set(name, now)
    return true
  }

  reset(): void {
    this.lastPlayed.clear()
    this.lastSeen.clear()
  }
}

/** The cues of an event mask that may sound at `now`. */
export function planEventCues(mask: number, now: number, gate: CueGate): EventCue[] {
  return eventCues(mask).filter(name => gate.allow(name, now))
}

/** Picks a variant and a playback rate; `random` returns [0, 1). */
export function voiceFor(spec: CueSpec, random: () => number): { sound: CueSound; rate: number } {
  const index = Math.min(spec.variants.length - 1, Math.floor(random() * spec.variants.length))
  const sound = spec.variants[index]
  if (sound === undefined) throw new RangeError('A cue needs at least one sound')
  return { sound, rate: spec.rate * (1 + (random() * 2 - 1) * spec.pitchSpread) }
}
