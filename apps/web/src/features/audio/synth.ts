import { BAR_SECONDS } from './grid'
import type { PitchClass } from './tracks'

/**
 * Sounds generated in code rather than shipped: the high-FLOW hat layer, the ceremony heartbeat,
 * the launch chord, risers and the reverb impulse. Renderers are deterministic, write plain
 * Float32Arrays once, and wrap ringing tails to the start so looped buffers stay seamless. They
 * run on the main thread, so the inner loops avoid per-sample trig and exp: oscillators read
 * wavetables, envelopes decay multiplicatively and filters update at control rate.
 */

export type Channels = [Float32Array, Float32Array]

const PITCH_CLASSES: readonly PitchClass[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const TABLE_SIZE = 2048
const CONTROL_FRAMES = 32

/** Frequency of `tonic` plus `semitones` in `octave` (A4 = 440 Hz). */
export function pitchHz(tonic: PitchClass, octave: number, semitones = 0): number {
  const midi = 12 * (octave + 1) + PITCH_CLASSES.indexOf(tonic) + semitones
  return 440 * 2 ** ((midi - 69) / 12)
}

/** Seeded PRNG (mulberry32) returning [-1, 1). */
function noise(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1
  }
}

function stereo(frames: number): Channels {
  return [new Float32Array(frames), new Float32Array(frames)]
}

function normalize(channels: readonly Float32Array[], peakLevel: number): void {
  let max = 0
  for (const channel of channels) for (const sample of channel) max = Math.max(max, Math.abs(sample))
  if (max === 0) return
  const gain = peakLevel / max
  for (const channel of channels) for (let i = 0; i < channel.length; i++) channel[i]! *= gain
}

/** Equal-power gains for a pan position from -1 (left) to 1 (right). */
function panGains(pan: number): readonly [number, number] {
  const angle = ((Math.min(1, Math.max(-1, pan)) + 1) * Math.PI) / 4
  return [Math.cos(angle), Math.sin(angle)]
}

/** Per-sample multiplier that decays by 1/e every `seconds`. */
function decayPerSample(seconds: number, sampleRate: number): number {
  return Math.exp(-1 / (seconds * sampleRate))
}

/** One cycle of a waveform with the given partial weights (index 0 = fundamental). */
function wavetable(weights: readonly number[]): Float32Array {
  const table = new Float32Array(TABLE_SIZE)
  weights.forEach((weight, partial) => {
    for (let i = 0; i < TABLE_SIZE; i++) table[i]! += weight * Math.sin((2 * Math.PI * (partial + 1) * i) / TABLE_SIZE)
  })
  return table
}

const sawWeights = (partials: number): number[] => Array.from({ length: partials }, (_, index) => 1 / (index + 1))

/** Adds a mono event into a looping stereo buffer, wrapping past the end back to the start. */
function addWrapped(target: Channels, start: number, event: Float32Array, gains: readonly [number, number]): void {
  const frames = target[0].length
  for (let i = 0; i < event.length; i++) {
    const index = (start + i) % frames
    target[0][index]! += event[i]! * gains[0]
    target[1][index]! += event[i]! * gains[1]
  }
}

/** A short burst of brightened noise with an exponential decay. */
function hatEvent(sampleRate: number, decay: number, level: number, random: () => number): Float32Array {
  const event = new Float32Array(Math.round(decay * 6 * sampleRate))
  const fall = decayPerSample(decay, sampleRate)
  let envelope = level
  let previous = 0
  for (let i = 0; i < event.length; i++) {
    const white = random()
    event[i] = (white - previous) * envelope
    previous = white
    envelope *= fall
  }
  return event
}

function pluckEvent(sampleRate: number, hz: number, table: Float32Array): Float32Array {
  const event = new Float32Array(Math.round(0.4 * sampleRate))
  const increment = (hz * TABLE_SIZE) / sampleRate
  const fall = decayPerSample(0.09, sampleRate)
  let envelope = 0.1
  let phase = 0
  for (let i = 0; i < event.length; i++) {
    event[i] = table[phase | 0]! * envelope
    envelope *= fall
    phase = (phase + increment) % TABLE_SIZE
  }
  return event
}

/**
 * One bar at 144 BPM for high FLOW: closed hats on the off-beats, ghost sixteenths, an open hat
 * lifting into the next bar and, when the track's tonic is known, a quiet root-fifth-octave pluck
 * line, which sits in both the major and the minor reading of the key.
 */
export function renderHatBar(sampleRate: number, tonic: PitchClass | null): Channels {
  const frames = Math.round(BAR_SECONDS * sampleRate)
  const out = stereo(frames)
  const step = frames / 16
  const random = noise(144)

  for (let s = 0; s < 16; s++) {
    const at = Math.round(s * step)
    if (s % 4 === 2) addWrapped(out, at, hatEvent(sampleRate, 0.03, 0.5, random), panGains(s % 8 === 2 ? -0.35 : 0.35))
    else if (s % 2 === 1) addWrapped(out, at, hatEvent(sampleRate, 0.012, 0.16, random), panGains(s % 4 === 1 ? 0.2 : -0.2))
  }
  addWrapped(out, Math.round(14 * step), hatEvent(sampleRate, 0.16, 0.28, random), panGains(0.1))

  if (tonic) {
    const table = wavetable([1, 0.25])
    const plucks = new Map<number, Float32Array>()
    ;[0, 7, 12, 7, 0, 7, 12, 19].forEach((semitones, eighth) => {
      let pluck = plucks.get(semitones)
      if (!pluck) {
        pluck = pluckEvent(sampleRate, pitchHz(tonic, 5, semitones), table)
        plucks.set(semitones, pluck)
      }
      addWrapped(out, Math.round(eighth * 2 * step), pluck, panGains(eighth % 2 === 0 ? -0.15 : 0.15))
    })
  }
  normalize(out, 0.5)
  return out
}

/** One heartbeat cycle ("lub-dub") at `bpm`, to be looped. */
export function renderHeartbeat(sampleRate: number, bpm = 54): Float32Array {
  const frames = Math.round((60 / bpm) * sampleRate)
  const out = new Float32Array(frames)
  const thump = (at: number, fromHz: number, toHz: number, decay: number, level: number) => {
    const length = Math.min(frames, Math.round(decay * 6 * sampleRate))
    const fall = decayPerSample(decay, sampleRate)
    const glide = decayPerSample(0.04, sampleRate)
    let envelope = level
    let sweep = fromHz - toHz
    let phase = 0
    for (let i = 0; i < length; i++) {
      const attack = Math.min(1, i / (0.004 * sampleRate))
      out[(at + i) % frames]! += Math.sin(phase) * envelope * attack
      phase += (2 * Math.PI * (toHz + sweep)) / sampleRate
      sweep *= glide
      envelope *= fall
    }
  }
  thump(0, 75, 42, 0.07, 1)
  thump(Math.round(0.28 * sampleRate), 62, 38, 0.055, 0.7)
  normalize([out], 0.9)
  return out
}

/**
 * The launch chord: tonic, fifth, octave, ninth and the octave's fifth. It has no third, so it
 * rings open over the ceremony bed whether the bed reads major or minor. Each voice glides from a
 * bright wavetable to a mellow one as it decays. Its range is low enough to render at 22.05 kHz.
 */
export function renderChord(sampleRate: number, tonic: PitchClass | null, seconds = 3.6): Channels {
  const frames = Math.round(seconds * sampleRate)
  const out = stereo(frames)
  const bright = wavetable(sawWeights(6))
  const mellow = wavetable(sawWeights(2))

  const envelope = new Float32Array(frames)
  const brightness = new Float32Array(frames)
  const fall = decayPerSample(1.6, sampleRate)
  const dull = decayPerSample(0.5, sampleRate)
  let level = 1
  let shine = 1
  for (let i = 0; i < frames; i++) {
    envelope[i] = level * Math.min(1, i / (0.035 * sampleRate)) * Math.min(1, (frames - i) / (0.3 * sampleRate))
    brightness[i] = shine
    level *= fall
    shine *= dull
  }

  const voices = [
    { semitones: 0, pan: 0, level: 1 },
    { semitones: 7, pan: -0.45, level: 0.7 },
    { semitones: 12, pan: 0.45, level: 0.7 },
    { semitones: 14, pan: -0.25, level: 0.45 },
    { semitones: 19, pan: 0.3, level: 0.4 },
  ]
  for (const voice of voices) {
    const hz = pitchHz(tonic ?? 'A', 3, voice.semitones)
    for (const detune of [-0.003, 0.003]) {
      const [left, right] = panGains(voice.pan + detune * 60)
      const increment = (hz * (1 + detune) * TABLE_SIZE) / sampleRate
      let phase = detune > 0 ? TABLE_SIZE / 3 : 0
      for (let i = 0; i < frames; i++) {
        const index = phase | 0
        const b = brightness[i]!
        const sample = (bright[index]! * b + mellow[index]! * (1 - b)) * envelope[i]! * voice.level
        out[0][i]! += sample * left
        out[1][i]! += sample * right
        phase += increment
        if (phase >= TABLE_SIZE) phase -= TABLE_SIZE
      }
    }
  }
  normalize(out, 0.6)
  return out
}

/**
 * Band-passed noise sweeping from `fromHz` to `toHz` while it swells. Long and gentle, it
 * announces the handoff gate; short and steep, it is the release swell under the launch.
 */
export function renderRiser(sampleRate: number, seconds: number, fromHz: number, toHz: number, seed: number): Channels {
  const frames = Math.round(seconds * sampleRate)
  const out = stereo(frames)
  out.forEach((channel, index) => {
    const source = noise(seed + index)
    let low = 0
    let band = 0
    let f = 0
    let swell = 0
    for (let i = 0; i < frames; i++) {
      if (i % CONTROL_FRAMES === 0) {
        const progress = i / frames
        const cutoff = Math.min(fromHz * (toHz / fromHz) ** progress, sampleRate / 6)
        f = 2 * Math.sin((Math.PI * cutoff) / sampleRate)
        swell = progress ** 2.2 * Math.min(1, (frames - i) / (0.015 * sampleRate))
      }
      const high = source() - low - 0.35 * band
      band += f * high
      low += f * band
      channel[i] = band * swell
    }
  })
  normalize(out, 0.5)
  return out
}

/** A stereo reverb impulse: decaying noise whose highs die first. Render at the context rate. */
export function renderImpulse(sampleRate: number, seconds = 2): Channels {
  const frames = Math.round(seconds * sampleRate)
  const out = stereo(frames)
  const preDelay = Math.round(0.012 * sampleRate)
  const fall = decayPerSample(seconds / 5.5, sampleRate)
  out.forEach((channel, index) => {
    const source = noise(7 + index)
    let smoothed = 0
    let envelope = 1
    let damping = 0.2
    for (let i = preDelay; i < frames; i++) {
      if (i % CONTROL_FRAMES === 0) damping = Math.min(0.97, 0.2 + ((i - preDelay) / sampleRate) * 0.45)
      smoothed = smoothed * damping + source() * (1 - damping)
      channel[i] = smoothed * envelope
      envelope *= fall
    }
  })
  normalize(out, 0.9)
  return out
}

// ---------------------------------------------------------------------------------------------
// Race one-shots for v6 moments no shipped sample covers. Mono, short, rendered once per context.
// ---------------------------------------------------------------------------------------------

export type SynthSoundId =
  | 'synth-lane-shift'
  | 'synth-lane-tick'
  | 'synth-shoulder'
  | 'synth-tether'
  | 'synth-rush'
  | 'synth-failed'
  | 'synth-draft'
  | 'synth-flow-rise'
  | 'synth-baton-lift'

interface ToneOptions {
  /** Seconds into the buffer. */
  at: number
  seconds: number
  fromHz: number
  toHz: number
  level: number
  /** Seconds to full level. */
  attack: number
  /** Seconds per 1/e of decay after the attack; Infinity holds until the fade-out. */
  decay: number
  table: Float32Array
}

/** Adds a tone gliding exponentially from `fromHz` to `toHz` with an attack, decay and a short tail fade. */
function addTone(out: Float32Array, sampleRate: number, options: ToneOptions): void {
  const start = Math.round(options.at * sampleRate)
  const frames = Math.min(out.length - start, Math.round(options.seconds * sampleRate))
  if (frames <= 0) return
  const glide = (options.toHz / options.fromHz) ** (1 / frames)
  const fall = Number.isFinite(options.decay) ? decayPerSample(options.decay, sampleRate) : 1
  const attack = Math.max(1, options.attack * sampleRate)
  const tail = Math.max(1, 0.012 * sampleRate)
  let hz = options.fromHz
  let phase = 0
  let envelope = options.level
  for (let i = 0; i < frames; i++) {
    const shape = Math.min(1, i / attack) * Math.min(1, (frames - i) / tail)
    out[start + i]! += options.table[phase | 0]! * envelope * shape
    phase += (hz * TABLE_SIZE) / sampleRate
    if (phase >= TABLE_SIZE) phase -= TABLE_SIZE
    hz *= glide
    if (i >= attack) envelope *= fall
  }
}

interface NoiseOptions {
  at: number
  seconds: number
  fromHz: number
  toHz: number
  level: number
  /** Resonance damping, lower rings more. */
  damping: number
  seed: number
  /** Envelope over the burst's own progress, 0..1 in and out. */
  shape: (progress: number) => number
}

/** Adds band-passed noise whose centre sweeps from `fromHz` to `toHz`. */
function addNoiseBand(out: Float32Array, sampleRate: number, options: NoiseOptions): void {
  const start = Math.round(options.at * sampleRate)
  const frames = Math.min(out.length - start, Math.round(options.seconds * sampleRate))
  const source = noise(options.seed)
  let low = 0
  let band = 0
  let f = 0
  let gain = 0
  for (let i = 0; i < frames; i++) {
    if (i % CONTROL_FRAMES === 0) {
      const progress = i / frames
      const cutoff = Math.min(options.fromHz * (options.toHz / options.fromHz) ** progress, sampleRate / 6)
      f = 2 * Math.sin((Math.PI * cutoff) / sampleRate)
      gain = options.level * options.shape(progress)
    }
    const high = source() - low - options.damping * band
    band += f * high
    low += f * band
    out[start + i]! += band * gain
  }
}

function mono(sampleRate: number, seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * sampleRate))
}

const SINE = wavetable([1])
const GLASS = wavetable([1, 0, 0.18, 0, 0.06])
const BUZZ = wavetable(sawWeights(8))
const HOLLOW = wavetable([1, 0, 1 / 9, 0, 1 / 25])

/** A lane change: a quick airy swish across the band. */
export function renderLaneShift(sampleRate: number): Float32Array {
  const out = mono(sampleRate, 0.2)
  addNoiseBand(out, sampleRate, { at: 0, seconds: 0.2, fromHz: 900, toHz: 4800, level: 1, damping: 0.55, seed: 31, shape: p => Math.min(1, p * 9) * (1 - p) ** 2 })
  normalize([out], 0.5)
  return out
}

/** A lane acquired: a soft, dry click that says "settled". */
export function renderLaneTick(sampleRate: number): Float32Array {
  const out = mono(sampleRate, 0.06)
  addTone(out, sampleRate, { at: 0, seconds: 0.06, fromHz: 2500, toHz: 2300, level: 1, attack: 0.001, decay: 0.009, table: GLASS })
  normalize([out], 0.45)
  return out
}

/** The shoulder: a rumble strip under the board, low buzz chopped at 16 Hz. */
export function renderShoulder(sampleRate: number): Float32Array {
  const seconds = 0.42
  const out = mono(sampleRate, seconds)
  addTone(out, sampleRate, { at: 0, seconds, fromHz: 92, toHz: 84, level: 1, attack: 0.01, decay: Infinity, table: BUZZ })
  const chop = Math.round(sampleRate / 16)
  const edge = Math.round(0.004 * sampleRate)
  for (let i = 0; i < out.length; i++) {
    const within = i % chop
    const open = within < chop * 0.55 ? Math.min(1, within / edge) : Math.max(0.15, 1 - (within - chop * 0.55) / edge)
    out[i]! *= open * Math.min(1, (out.length - i) / (0.08 * sampleRate))
  }
  normalize([out], 0.55)
  return out
}

/** The baton's tether: a bright snap, then a golden zing climbing a fifth-stacked glide. */
export function renderTether(sampleRate: number): Float32Array {
  const out = mono(sampleRate, 1.1)
  addNoiseBand(out, sampleRate, { at: 0, seconds: 0.05, fromHz: 5200, toHz: 2400, level: 1.4, damping: 0.3, seed: 57, shape: p => (1 - p) ** 3 })
  addTone(out, sampleRate, { at: 0.02, seconds: 1.05, fromHz: 520, toHz: 1560, level: 0.8, attack: 0.03, decay: 0.45, table: GLASS })
  addTone(out, sampleRate, { at: 0.02, seconds: 1.05, fromHz: 780, toHz: 2340, level: 0.45, attack: 0.05, decay: 0.4, table: SINE })
  normalize([out], 0.6)
  return out
}

/** Relay Rush ignition: a swelling riser that lands on a low thump and an open fifth. */
export function renderRush(sampleRate: number): Float32Array {
  const out = mono(sampleRate, 1.25)
  const land = 0.5
  addNoiseBand(out, sampleRate, { at: 0, seconds: land, fromHz: 400, toHz: 7000, level: 1, damping: 0.35, seed: 73, shape: p => p ** 2.4 })
  addTone(out, sampleRate, { at: land, seconds: 0.5, fromHz: 110, toHz: 46, level: 1.3, attack: 0.003, decay: 0.12, table: SINE })
  addTone(out, sampleRate, { at: land, seconds: 0.75, fromHz: 392, toHz: 392, level: 0.35, attack: 0.004, decay: 0.28, table: BUZZ })
  addTone(out, sampleRate, { at: land, seconds: 0.75, fromHz: 587.3, toHz: 587.3, level: 0.25, attack: 0.004, decay: 0.26, table: BUZZ })
  normalize([out], 0.65)
  return out
}

/** A failed leg: a hollow tone sinking an octave and a half, under a minor third. */
export function renderFailed(sampleRate: number): Float32Array {
  const out = mono(sampleRate, 1.5)
  addTone(out, sampleRate, { at: 0, seconds: 1.5, fromHz: 330, toHz: 110, level: 1, attack: 0.02, decay: 0.6, table: HOLLOW })
  addTone(out, sampleRate, { at: 0.08, seconds: 1.42, fromHz: 277.2, toHz: 92.5, level: 0.6, attack: 0.03, decay: 0.55, table: HOLLOW })
  normalize([out], 0.6)
  return out
}

/** Drafting the Ghostline: a cool shimmer that swells in and out. */
export function renderDraft(sampleRate: number): Float32Array {
  const out = mono(sampleRate, 0.8)
  addNoiseBand(out, sampleRate, { at: 0, seconds: 0.8, fromHz: 5200, toHz: 8200, level: 0.8, damping: 0.25, seed: 91, shape: p => Math.sin(Math.PI * p) ** 2 })
  addTone(out, sampleRate, { at: 0.08, seconds: 0.7, fromHz: 2093, toHz: 2217, level: 0.18, attack: 0.25, decay: 0.3, table: SINE })
  normalize([out], 0.4)
  return out
}

/** FLOW rising a tier: two quick glassy notes a fifth apart. */
export function renderFlowRise(sampleRate: number): Float32Array {
  const out = mono(sampleRate, 0.4)
  addTone(out, sampleRate, { at: 0, seconds: 0.2, fromHz: 880, toHz: 880, level: 0.8, attack: 0.003, decay: 0.05, table: GLASS })
  addTone(out, sampleRate, { at: 0.1, seconds: 0.3, fromHz: 1318.5, toHz: 1318.5, level: 1, attack: 0.003, decay: 0.08, table: GLASS })
  normalize([out], 0.5)
  return out
}

/** The baton leaving the courier's hand: a breath and a slow glide upward. */
export function renderBatonLift(sampleRate: number): Float32Array {
  const out = mono(sampleRate, 0.9)
  addNoiseBand(out, sampleRate, { at: 0, seconds: 0.9, fromHz: 1800, toHz: 4200, level: 0.5, damping: 0.4, seed: 113, shape: p => Math.sin(Math.PI * p) })
  addTone(out, sampleRate, { at: 0.05, seconds: 0.85, fromHz: 440, toHz: 1320, level: 0.7, attack: 0.3, decay: 0.35, table: GLASS })
  normalize([out], 0.5)
  return out
}

export const SYNTH_SOUNDS: Readonly<Record<SynthSoundId, (sampleRate: number) => Float32Array>> = {
  'synth-lane-shift': renderLaneShift,
  'synth-lane-tick': renderLaneTick,
  'synth-shoulder': renderShoulder,
  'synth-tether': renderTether,
  'synth-rush': renderRush,
  'synth-failed': renderFailed,
  'synth-draft': renderDraft,
  'synth-flow-rise': renderFlowRise,
  'synth-baton-lift': renderBatonLift,
}

export function isSynthSound(id: string): id is SynthSoundId {
  return Object.hasOwn(SYNTH_SOUNDS, id)
}
