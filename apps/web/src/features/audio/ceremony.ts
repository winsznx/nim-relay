import { toAudioBuffer } from './buffers'
import type { MixBus } from './graph'
import type { HapticKind } from './haptics'
import { planCeremony, type CeremonyAccent, type CeremonyStage } from './scenes'
import { renderChord, renderHeartbeat, renderRiser } from './synth'
import type { PitchClass, SoundId } from './tracks'
import { LoopVoice, OneShotPool } from './voices'

/** What the ceremony needs from the rest of the audio engine. */
export interface CeremonyHost {
  readonly ctx: BaseAudioContext
  readonly bus: MixBus
  /** The ceremony bed layer and the level the scene gives it. */
  bed(): { voice: LoopVoice; level: number } | null
  playSound(id: SoundId, gain: number): void
  haptic(kind: HapticKind): void
}

interface CeremonySynth {
  heartbeat: AudioBuffer
  chord: AudioBuffer
  riser: AudioBuffer
  swell: AudioBuffer
}

type SynthPart = keyof CeremonySynth

const HEARTBEAT_LEVEL = 0.8
/** The launch chord blooms out of the release swell rather than on top of it. */
const CHORD_DELAY_SECONDS = 0.28
/** The chord's range is low enough to synthesize at a reduced rate, for a fraction of the one-off cost. */
const CHORD_SAMPLE_RATE = 22050

/**
 * The handoff ceremony's sound. The bed is the ceremony music; stages reshape it (filter, rate,
 * reverb), run a heartbeat under the wallet approval, and fire one-shot accents: a riser as the
 * handoff approaches, and a swell, whoosh and open chord when the transfer is confirmed.
 */
export class CeremonyAudio {
  private stage: CeremonyStage | null = null
  private parts: Partial<CeremonySynth> = {}
  private partsTonic: PitchClass | null = null
  private readonly heartbeat: LoopVoice
  private readonly accents: OneShotPool

  constructor(private readonly host: CeremonyHost) {
    this.heartbeat = new LoopVoice(host.ctx, host.bus.ambience)
    this.accents = new OneShotPool(host.ctx, host.bus.accents, 4)
  }

  get currentStage(): CeremonyStage | null {
    return this.stage
  }

  /**
   * Render steps for the synthesized parts that are not ready yet, tuned to the ceremony bed.
   * The engine runs them one per task ahead of the ceremony so none of them stalls a frame.
   */
  pendingRenders(tonic: PitchClass | null): (() => void)[] {
    const parts: SynthPart[] = ['riser', 'heartbeat', 'swell', 'chord']
    const current = tonic === this.partsTonic ? this.parts : {}
    return parts.filter(part => !current[part]).map(part => () => this.render(part, tonic))
  }

  /** `withAccents` false applies the mix silently, for a stage reached while audio was suspended. */
  enter(stage: CeremonyStage, tonic: PitchClass | null, withAccents: boolean): void {
    const mix = planCeremony(this.stage, stage)
    if (!mix) return
    this.stage = stage
    const { bus, ctx } = this.host
    const glide = mix.glideSeconds

    bus.shapeMusic({ lowpassHz: mix.lowpassHz, brightnessDb: 0, width: 1 }, glide / 3)
    bus.setReverb(mix.reverb, glide / 3)
    const bed = this.host.bed()
    if (bed) {
      bed.voice.glideLevel(bed.level * mix.bedGain, glide / 3)
      bed.voice.glideRate(mix.playbackRate, glide / 3)
    }

    if (mix.heartbeat > 0 && !this.heartbeat.playing) {
      const heartbeat = this.part('heartbeat', tonic)
      this.heartbeat.start(heartbeat, { when: ctx.currentTime + 0.05, offset: 0, loopSeconds: heartbeat.duration, fade: 0.2 })
    }
    this.heartbeat.glideLevel(mix.heartbeat * HEARTBEAT_LEVEL, glide / 3)
    if (mix.heartbeat === 0) this.heartbeat.stop(glide * 2)

    if (withAccents) for (const accent of mix.accents) this.play(accent, tonic)
  }

  /** Leaving the ceremony: everything it changed goes back to neutral. */
  reset(fade: number): void {
    if (this.stage === null) return
    this.stage = null
    this.heartbeat.stop(fade)
    this.host.bus.releaseReverb()
    this.host.bed()?.voice.glideRate(1, fade / 3)
  }

  dispose(): void {
    this.heartbeat.dispose()
    this.accents.dispose()
  }

  /** A synthesized part, rendered now if warm-up has not reached it yet (only what a stage plays). */
  private part(part: SynthPart, tonic: PitchClass | null): AudioBuffer {
    this.render(part, tonic)
    const buffer = this.parts[part]
    if (!buffer) throw new Error(`Ceremony ${part} did not render`)
    return buffer
  }

  private render(part: SynthPart, tonic: PitchClass | null): void {
    if (tonic !== this.partsTonic) {
      this.parts = {}
      this.partsTonic = tonic
    }
    if (this.parts[part]) return
    const { ctx } = this.host
    const rate = ctx.sampleRate
    const rendered: Record<SynthPart, () => AudioBuffer> = {
      heartbeat: () => toAudioBuffer(ctx, [renderHeartbeat(rate)], rate),
      riser: () => toAudioBuffer(ctx, renderRiser(rate, 2.2, 300, 3800, 11), rate),
      swell: () => toAudioBuffer(ctx, renderRiser(rate, 0.35, 900, 9000, 23), rate),
      chord: () => toAudioBuffer(ctx, renderChord(CHORD_SAMPLE_RATE, tonic), CHORD_SAMPLE_RATE),
    }
    this.parts[part] = rendered[part]()
  }

  private play(accent: CeremonyAccent, tonic: PitchClass | null): void {
    switch (accent) {
      case 'riser':
        this.accents.play(this.part('riser', tonic), { gain: 0.35, rate: 1, pan: 0 })
        return
      case 'swell':
        this.accents.play(this.part('swell', tonic), { gain: 0.5, rate: 1, pan: 0 })
        return
      case 'chord':
        this.accents.play(this.part('chord', tonic), { gain: 0.55, rate: 1, pan: 0, delay: CHORD_DELAY_SECONDS })
        return
      case 'whoosh':
        this.host.playSound('launch-whoosh', 0.7)
        return
      case 'chime':
        this.host.playSound('arrival', 0.65)
        return
      case 'heartbeat-haptic':
        this.host.haptic('heartbeat')
        return
      case 'launch-haptic':
        this.host.haptic('launch')
        return
    }
  }
}
