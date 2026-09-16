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
