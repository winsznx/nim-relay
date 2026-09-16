import { glide, holdAt } from './graph'
import { loopPosition } from './grid'

/**
 * Playback building blocks. AudioBufferSourceNodes are single-use by design, so a source (and its
 * short-lived envelope) is created per start; the level and pan nodes around it live as long as
 * the layer or slot does.
 */

interface LoopSource {
  source: AudioBufferSourceNode
  envelope: GainNode
  when: number
  offset: number
  loopSeconds: number
  buffer: AudioBuffer
  /** Scheduled end once released; Infinity while playing. */
  stopAt: number
}

export interface LoopStartOptions {
  when: number
  offset: number
  loopSeconds: number
  /** Seconds to fade in, and to crossfade out whatever this layer was playing. */
  fade: number
}

/** A continuous layer (a bed, the race music, the wind): one looping buffer at a time. */
export class LoopVoice {
  readonly output: GainNode
  private current: LoopSource | null = null
  /** Sources fading out; a later stop can still cut them shorter. */
  private readonly releasing = new Set<LoopSource>()

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
    level = 0,
  ) {
    this.output = ctx.createGain()
    this.output.gain.value = level
    this.output.connect(destination)
  }

  get playing(): boolean {
    return this.current !== null
  }

  get buffer(): AudioBuffer | null {
    return this.current?.buffer ?? null
  }

  get loopSeconds(): number | null {
    return this.current?.loopSeconds ?? null
  }

  /** Context time at which loop position 0 plays (modulo the loop). Valid at playback rate 1. */
  get anchor(): number | null {
    return this.current ? this.current.when - this.current.offset : null
  }

  /** Loop position at context time `time`, assuming playback rate 1. */
  positionAt(time: number): number | null {
    const current = this.current
    return current ? loopPosition(current.offset + (time - current.when), current.loopSeconds) : null
  }

  start(buffer: AudioBuffer, { when, offset, loopSeconds, fade }: LoopStartOptions): void {
    const previous = this.current
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.loopStart = 0
    source.loopEnd = Math.min(loopSeconds, buffer.duration)
    const envelope = this.ctx.createGain()
    if (fade > 0) {
      envelope.gain.setValueAtTime(0, when)
      envelope.gain.linearRampToValueAtTime(1, when + fade)
    }
    source.connect(envelope).connect(this.output)
    const position = loopPosition(offset, source.loopEnd)
    const voice: LoopSource = { source, envelope, when, offset: position, loopSeconds: source.loopEnd, buffer, stopAt: Infinity }
    source.onended = () => {
      this.releasing.delete(voice)
      source.disconnect()
      envelope.disconnect()
    }
    source.start(when, position)
    this.current = voice
    if (previous) this.release(previous, when, fade)
  }

  /** Fades out what is playing, including earlier sources still fading, from `at`. */
  stop(fade: number, at = this.ctx.currentTime): void {
    for (const voice of this.releasing) this.release(voice, at, fade)
    if (!this.current) return
    this.release(this.current, at, fade)
    this.current = null
  }

  glideLevel(level: number, timeConstant: number): void {
    glide(this.output.gain, level, this.ctx.currentTime, timeConstant)
  }

  /** Playback rate of the playing source; it restarts at rate 1 on the next start. */
  glideRate(rate: number, timeConstant: number): void {
    if (this.current) glide(this.current.source.playbackRate, rate, this.ctx.currentTime, timeConstant)
  }

  dispose(): void {
    this.stop(0)
    this.output.disconnect()
  }

  /** Fades a source out from `at`. A source already fading is only ever cut shorter. */
  private release(voice: LoopSource, at: number, fade: number): void {
    const when = Math.max(at, this.ctx.currentTime)
    const stopAt = when + Math.max(0.01, fade) + 0.02
    if (stopAt >= voice.stopAt) return
    holdAt(voice.envelope.gain, when)
    voice.envelope.gain.setTargetAtTime(0, when, Math.max(0.002, fade / 6))
    voice.source.stop(stopAt)
    voice.stopAt = stopAt
    this.releasing.add(voice)
  }
}

interface Slot {
  gain: GainNode
  panner: StereoPannerNode | null
  source: AudioBufferSourceNode | null
  startedAt: number
  endsAt: number
}

export interface OneShotOptions {
  gain: number
  rate: number
  /** -1 left .. 1 right. */
  pan: number
  /** Seconds from now. */
  delay?: number
}

/** Seconds a stolen voice takes to fade before its slot is reused. */
const STEAL_SECONDS = 0.015

/**
 * A fixed set of one-shot slots. When all are busy the oldest sound is faded out and its slot
 * reused, which caps simultaneous one-shots however fast cues arrive.
 */
export class OneShotPool {
  private readonly slots: Slot[]

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
    size: number,
  ) {
    this.slots = Array.from({ length: size }, () => {
      const gain = ctx.createGain()
      const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null
      if (panner) gain.connect(panner).connect(destination)
      else gain.connect(destination)
      return { gain, panner, source: null, startedAt: 0, endsAt: 0 }
    })
  }

  play(buffer: AudioBuffer, { gain, rate, pan, delay = 0 }: OneShotOptions): void {
    const now = this.ctx.currentTime
    const free = this.slots.find(slot => slot.endsAt <= now)
    const slot = free ?? this.slots.reduce((oldest, candidate) => (candidate.startedAt < oldest.startedAt ? candidate : oldest))
    let when = now + Math.max(0, delay)
    if (!free && slot.source) {
      holdAt(slot.gain.gain, now)
      slot.gain.gain.setTargetAtTime(0, now, STEAL_SECONDS / 5)
      slot.source.stop(now + STEAL_SECONDS)
      when = Math.max(when, now + STEAL_SECONDS)
    }

    holdAt(slot.gain.gain, when)
    slot.gain.gain.setValueAtTime(gain, when)
    if (slot.panner) {
      holdAt(slot.panner.pan, when)
      slot.panner.pan.setValueAtTime(pan, when)
    }
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = rate
    source.connect(slot.gain)
    source.onended = () => {
      source.disconnect()
      if (slot.source === source) slot.source = null
    }
    source.start(when)
    slot.source = source
    slot.startedAt = when
    slot.endsAt = when + buffer.duration / rate
  }

  stopAll(fade = 0.05): void {
    const now = this.ctx.currentTime
    for (const slot of this.slots) {
      if (!slot.source) continue
      glide(slot.gain.gain, 0, now, fade / 4)
      slot.source.stop(now + fade)
      slot.endsAt = now
    }
  }

  dispose(): void {
    this.stopAll(0.01)
    for (const slot of this.slots) {
      slot.gain.disconnect()
      slot.panner?.disconnect()
    }
  }
}
