/**
 * The mixer. Every node is created once, when the AudioContext is; only the reverb is built on
 * first use and torn down when nothing needs it, since a convolver costs CPU even when silent.
 *
 *   beds, race music, hats ─► music ─► low-pass ─► high-shelf ─► duck ─► width ─┬─► limiter ─► master ─► out
 *                                          └──────────────► reverb send ─► convolver ─┤
 *   ceremony accents ─► accents ─────────────────────────────┴─► reverb send          │
 *   wind, hover, rail, heartbeat ─► ambience ─────────────────────────────────────────┤
 *   gameplay one-shots ─► sfx ────────────────────────────────────────────────────────┤
 *   interface one-shots ─► ui ────────────────────────────────────────────────────────┘
 */

/** DynamicsCompressorNode looks ahead by a fixed 6 ms in Chromium and WebKit, delaying everything after it. */
export const LIMITER_LATENCY_SECONDS = 0.006

/** Longer than the impulse response, so a released reverb rings out before it is disconnected. */
const REVERB_TAIL_MS = 3500

/** Glides an AudioParam from wherever it is now, without the click a cancelled ramp leaves. */
export function glide(param: AudioParam, value: number, at: number, timeConstant: number): void {
  holdAt(param, at)
  param.setTargetAtTime(value, at, Math.max(0.001, timeConstant))
}

export function holdAt(param: AudioParam, at: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(at)
    return
  }
  param.cancelScheduledValues(at)
  param.setValueAtTime(param.value, at)
}

/** Mid/side width control on a stereo signal: 1 leaves it as mixed, above 1 widens. */
class StereoWidth {
  readonly input: GainNode
  readonly output: ChannelMergerNode
  private readonly sideLeft: GainNode
  private readonly sideRight: GainNode

  constructor(ctx: BaseAudioContext) {
    this.input = ctx.createGain()
    this.input.channelCount = 2
    this.input.channelCountMode = 'explicit'
    this.input.channelInterpretation = 'speakers'
    const split = ctx.createChannelSplitter(2)
    const mid = ctx.createGain()
    mid.gain.value = 0.5
    const side = ctx.createGain()
    side.gain.value = 0.5
    const invertRight = ctx.createGain()
    invertRight.gain.value = -1
    this.sideLeft = ctx.createGain()
    this.sideRight = ctx.createGain()
    this.sideRight.gain.value = -1
    this.output = ctx.createChannelMerger(2)

    this.input.connect(split)
    split.connect(mid, 0)
    split.connect(mid, 1)
    split.connect(side, 0)
    split.connect(invertRight, 1)
    invertRight.connect(side)
    mid.connect(this.output, 0, 0)
    mid.connect(this.output, 0, 1)
    side.connect(this.sideLeft)
    side.connect(this.sideRight)
    this.sideLeft.connect(this.output, 0, 0)
    this.sideRight.connect(this.output, 0, 1)
  }

  glide(width: number, at: number, timeConstant: number): void {
    glide(this.sideLeft.gain, width, at, timeConstant)
    glide(this.sideRight.gain, -width, at, timeConstant)
  }
}

export class MixBus {
  readonly music: GainNode
  readonly accents: GainNode
  readonly ambience: GainNode
  readonly sfx: GainNode
  readonly ui: GainNode

  private readonly lowpass: BiquadFilterNode
  private readonly shelf: BiquadFilterNode
  private readonly duck: GainNode
  private readonly width: StereoWidth
  private readonly sum: GainNode
  private readonly master: GainNode
  private reverb: { send: GainNode; convolver: ConvolverNode } | null = null
  private reverbTarget = { amount: 0, timeConstant: 0.1 }
  private reverbBuild: ReturnType<typeof setTimeout> | null = null
  private readonly releaseTimers = new Set<ReturnType<typeof setTimeout>>()

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly impulse: () => AudioBuffer,
  ) {
    this.music = ctx.createGain()
    this.accents = ctx.createGain()
    this.ambience = ctx.createGain()
    this.sfx = ctx.createGain()
    this.ui = ctx.createGain()
    this.lowpass = ctx.createBiquadFilter()
    this.lowpass.type = 'lowpass'
    this.lowpass.frequency.value = 20000
    this.lowpass.Q.value = 0.5
    this.shelf = ctx.createBiquadFilter()
    this.shelf.type = 'highshelf'
    this.shelf.frequency.value = 5000
    this.duck = ctx.createGain()
    this.width = new StereoWidth(ctx)
    this.sum = ctx.createGain()
    this.master = ctx.createGain()

    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -4
    limiter.knee.value = 3
    limiter.ratio.value = 16
    limiter.attack.value = 0.002
    limiter.release.value = 0.15

    this.music.connect(this.lowpass).connect(this.shelf).connect(this.duck).connect(this.width.input)
    this.width.output.connect(this.sum)
    for (const bus of [this.accents, this.ambience, this.sfx, this.ui]) bus.connect(this.sum)
    this.sum.connect(limiter).connect(this.master).connect(ctx.destination)
  }

  setMuted(muted: boolean, seconds = 0.08): void {
    glide(this.master.gain, muted ? 0 : 1, this.ctx.currentTime, seconds / 4)
  }

  shapeMusic(shape: { lowpassHz: number; brightnessDb: number; width: number }, timeConstant: number): void {
    const now = this.ctx.currentTime
    glide(this.lowpass.frequency, Math.min(shape.lowpassHz, this.ctx.sampleRate / 2), now, timeConstant)
    glide(this.shelf.gain, shape.brightnessDb, now, timeConstant)
    this.width.glide(shape.width, now, timeConstant)
  }

  /** Dips the music to `depth` quickly and lets it recover after `holdSeconds`. */
  duckMusic(depth: number, holdSeconds: number): void {
    const now = this.ctx.currentTime
    const gain = this.duck.gain
    holdAt(gain, now)
    gain.setTargetAtTime(depth, now, 0.015)
    gain.setTargetAtTime(1, now + holdSeconds, 0.18)
  }

  /**
   * Reverb send level for the music and accents. The convolver is built on first use in a task of
   * its own (setting its buffer is costly), and the send glides in once it exists.
   */
  setReverb(amount: number, timeConstant: number): void {
    this.reverbTarget = { amount, timeConstant }
    if (this.reverb) {
      glide(this.reverb.send.gain, amount, this.ctx.currentTime, timeConstant)
      return
    }
    if (amount <= 0 || this.reverbBuild) return
    this.reverbBuild = setTimeout(() => {
      this.reverbBuild = null
      const reverb = this.buildReverb()
      glide(reverb.send.gain, this.reverbTarget.amount, this.ctx.currentTime, this.reverbTarget.timeConstant)
    }, 0)
  }

  /** Disconnects the reverb once its send and tail have faded, so it stops costing CPU. */
  releaseReverb(): void {
    if (this.reverbBuild) clearTimeout(this.reverbBuild)
    this.reverbBuild = null
    if (!this.reverb) return
    const { send, convolver } = this.reverb
    this.reverb = null
    glide(send.gain, 0, this.ctx.currentTime, 0.05)
    const timer = setTimeout(() => {
      this.releaseTimers.delete(timer)
      this.lowpass.disconnect(send)
      this.accents.disconnect(send)
      send.disconnect()
      convolver.disconnect()
    }, REVERB_TAIL_MS)
    this.releaseTimers.add(timer)
  }

  dispose(): void {
    if (this.reverbBuild) clearTimeout(this.reverbBuild)
    for (const timer of this.releaseTimers) clearTimeout(timer)
    this.releaseTimers.clear()
    this.master.disconnect()
  }

  private buildReverb(): { send: GainNode; convolver: ConvolverNode } {
    const send = this.ctx.createGain()
    send.gain.value = 0
    const convolver = this.ctx.createConvolver()
    convolver.buffer = this.impulse()
    this.lowpass.connect(send)
    this.accents.connect(send)
    send.connect(convolver).connect(this.sum)
    this.reverb = { send, convolver }
    return this.reverb
  }
}
