import type { relayLeg } from '@nim-relay/game-engine'
import { BufferCache, toAudioBuffer } from './buffers'
import { CeremonyAudio } from './ceremony'
import { CUES, voiceFor, type CueName, type CueSpec } from './cues'
import { heardTime, loopPosition, type ClockReading } from './grid'
import { LIMITER_LATENCY_SECONDS, MixBus } from './graph'
import type { HapticKind } from './haptics'
import { flowMix, LOWPASS_OPEN_HZ, speedMix } from './mix'
import { RaceMusic } from './race-music'
import { planScene, SCENE_MIXES, type BedLayer, type BedStart, type CeremonyStage, type SceneKind } from './scenes'
import { renderHatBar, renderImpulse } from './synth'
import { SOUNDS, TRACKS, type PitchClass, type SoundId, type TrackMeta, type TrackRole } from './tracks'
import { LoopVoice, OneShotPool, type OneShotOptions } from './voices'

const SFX_VOICES = 12
const UI_VOICES = 4
const HAT_LEVEL = 0.4
const LAYER_GAIN = 0.8
const PAN_SWING = 0.6
/** Beds longer than this give their decoded buffer back when their scene ends (tens of MB each). */
const RELEASE_AFTER_SECONDS = 30
/** Continuous inputs (FLOW, speed) only move the mix when they change by at least this much. */
const CONTROL_STEP = 0.01

const TRACK_LIST: readonly TrackMeta[] = Object.values(TRACKS)

function trackFor(role: TrackRole): TrackMeta {
  const track = TRACK_LIST.find(candidate => candidate.role === role)
  if (!track) throw new Error(`No ${role} track in tracks.ts`)
  return track
}

const BED_TRACKS: Readonly<Record<BedLayer, TrackMeta>> = { world: trackFor('world'), station: trackFor('station'), ceremony: trackFor('ceremony') }
const WIND = trackFor('wind')
const HOVER = trackFor('hover')
const RAIL = trackFor('rail')

/** The race track for a world; worlds without their own track ride to the first one. */
export function raceTrackFor(world: relayLeg.World): TrackMeta {
  return TRACK_LIST.find(track => track.role === 'race' && track.worlds.includes(world)) ?? trackFor('race')
}

function soundUrls(include: (spec: CueSpec) => boolean, extra: readonly SoundId[] = []): string[] {
  const ids = new Set<SoundId>(extra)
  for (const spec of Object.values(CUES)) {
    if (include(spec)) for (const id of [...spec.variants, ...spec.layers]) ids.add(id)
  }
  return [...ids].map(id => SOUNDS[id].url)
}

const UI_SOUNDS = soundUrls(spec => spec.bus === 'ui')
const RACE_SOUNDS = soundUrls(spec => spec.bus === 'sfx')
const CEREMONY_SOUNDS = soundUrls(() => false, ['launch-whoosh', 'arrival'])

const changedEnough = (previous: number, next: number): boolean =>
  next !== previous && (Math.abs(next - previous) >= CONTROL_STEP || next === 0 || next === 1)

const unit = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0)

/**
 * Everything that exists once there is an AudioContext: the mixer, loaded buffers, layers and
 * one-shot pools, and how scenes, the race and the ceremony drive them. The director decides
 * when and whether anything plays; the engine decides how it sounds.
 */
export class AudioEngine {
  readonly bus: MixBus
  private readonly cache: BufferCache
  private readonly sfx: OneShotPool
  private readonly ui: OneShotPool
  private readonly beds: Readonly<Record<BedLayer, LoopVoice>>
  private readonly wind: LoopVoice
  private readonly hover: LoopVoice
  private readonly rail: LoopVoice
  private readonly music: LoopVoice
  private readonly hats: LoopVoice
  private readonly raceMusic: RaceMusic
  private readonly ceremony: CeremonyAudio
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private readonly clock: ClockReading = { currentTime: 0, outputLatency: 0, stamp: null }
  private readonly stamp = { contextTime: 0, performanceTime: 0 }

  private scene: SceneKind = 'silent'
  private raceTrack: TrackMeta | null = null
  private hatTonic: PitchClass | null | undefined
  private flow = 0
  private speed = 0
  private railing = false
  private panSide = 1
  private impulse: AudioBuffer | null = null

  constructor(
    readonly ctx: AudioContext,
    private readonly random: () => number,
    private readonly haptic: (kind: HapticKind) => void,
  ) {
    this.bus = new MixBus(ctx, () => this.impulseResponse())
    this.cache = new BufferCache(ctx)
    this.sfx = new OneShotPool(ctx, this.bus.sfx, SFX_VOICES)
    this.ui = new OneShotPool(ctx, this.bus.ui, UI_VOICES)
    this.beds = {
      world: new LoopVoice(ctx, this.bus.music),
      station: new LoopVoice(ctx, this.bus.music),
      ceremony: new LoopVoice(ctx, this.bus.music),
    }
    this.wind = new LoopVoice(ctx, this.bus.ambience)
    this.hover = new LoopVoice(ctx, this.bus.ambience)
    this.rail = new LoopVoice(ctx, this.bus.ambience)
    this.music = new LoopVoice(ctx, this.bus.music)
    this.hats = new LoopVoice(ctx, this.bus.music)
    this.raceMusic = new RaceMusic(ctx, this.music, this.hats, () => this.raceTrack?.gain ?? 1)
    this.ceremony = new CeremonyAudio({
      ctx,
      bus: this.bus,
      bed: () => ({ voice: this.beds.ceremony, level: BED_TRACKS.ceremony.gain * SCENE_MIXES.ceremony.beds.ceremony }),
      playSound: (id, gain) => this.playSound(id, { gain, rate: 1, pan: 0 }, this.sfx),
      haptic: kind => this.haptic(kind),
    })
    void this.cache.loadAll(UI_SOUNDS)
  }

  setMuted(muted: boolean): void {
    this.bus.setMuted(muted)
  }

  applyScene(from: SceneKind, to: SceneKind): void {
    const plan = planScene(from, to)
    this.scene = to
    if (!plan) return
    const fade = plan.fadeSeconds
    // Read the phase of beds a new bed will align to before they are stopped.
    const phases = new Map(plan.startBeds.map(start => [start.layer, start.alignTo ? this.phaseOf(start.alignTo) : null]))
    for (const layer of plan.stopBeds) this.stopBed(layer, fade)
    for (const start of plan.startBeds) this.startBed(start, phases.get(start.layer) ?? null, fade)
    if (plan.stopRaceAmbience) for (const voice of [this.wind, this.hover, this.rail]) voice.stop(fade)
    if (plan.startRaceAmbience) this.startRaceAmbience(fade)
    if (plan.stopRaceMusic) this.stopRaceMusic(fade)
    if (from === 'ceremony') this.ceremony.reset(fade)

    if (to === 'race') {
      void this.cache.loadAll(RACE_SOUNDS)
      this.applyFlow(fade / 3)
    } else if (to === 'ceremony') {
      void this.cache.loadAll(CEREMONY_SOUNDS)
      this.renderOnePerTask([
        () => {
          this.impulseResponse()
        },
        ...this.ceremony.pendingRenders(BED_TRACKS.ceremony.tonic),
      ])
    } else {
      this.bus.shapeMusic({ lowpassHz: LOWPASS_OPEN_HZ, brightnessDb: 0, width: 1 }, fade / 3)
    }
  }

  /** Loads and arms the world's race track; it starts when the race clock runs. */
  prepareRace(world: relayLeg.World): void {
    const track = raceTrackFor(world)
    this.raceMusic.reset()
    this.flow = 0
    this.speed = 0
    this.setRailing(false)
    this.applyFlow(0.05)
    if (this.raceTrack && this.raceTrack !== track) this.cache.release(this.raceTrack.url)
    this.raceTrack = track
    if (this.hatTonic !== track.tonic) {
      const tonic = track.tonic
      this.hatTonic = tonic
      this.later(0, () => {
        if (this.raceTrack?.tonic === tonic) this.raceMusic.setHats(toAudioBuffer(this.ctx, renderHatBar(this.ctx.sampleRate, tonic), this.ctx.sampleRate))
      })
    }
    void this.cache.load(track.url).then(buffer => {
      if (buffer && this.raceTrack === track) this.raceMusic.setTrack(buffer, track.loopSeconds)
    })
  }

  syncRace(tick: number, running: boolean): void {
    if (this.scene === 'race') this.raceMusic.sync(this.heardNow(), tick, running)
  }

  setFlow(flow: number): void {
    const next = unit(flow)
    if (!changedEnough(this.flow, next)) return
    this.flow = next
    if (this.scene === 'race') this.applyFlow(0.12)
  }

  setSpeed(speed: number): void {
    const next = unit(speed)
    if (!changedEnough(this.speed, next)) return
    this.speed = next
    if (this.scene === 'race') this.applyAmbience(0.08)
  }

  setRailing(railing: boolean): void {
    if (railing === this.railing) return
    this.railing = railing
    this.rail.glideLevel(railing ? RAIL.gain : 0, railing ? 0.02 : 0.05)
  }

  playCue(name: CueName): void {
    const spec = CUES[name]
    const pool = spec.bus === 'ui' ? this.ui : this.sfx
    const { sound, rate } = voiceFor(spec, this.random)
    const pan = spec.pan === 'alternate' ? (this.panSide = -this.panSide) * PAN_SWING : 0
    this.playSound(sound, { gain: spec.gain, rate, pan }, pool)
    for (const layer of spec.layers) this.playSound(layer, { gain: spec.gain * LAYER_GAIN, rate, pan }, pool)
    if (spec.duck) this.bus.duckMusic(spec.duck.depth, spec.duck.seconds)
    if (name === 'finish' || name === 'finish-win' || name === 'finish-lose') this.raceMusic.finish()
  }

  enterCeremony(stage: CeremonyStage, withAccents: boolean): void {
    this.ceremony.enter(stage, BED_TRACKS.ceremony.tonic, withAccents)
  }

  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    for (const voice of [...Object.values(this.beds), this.wind, this.hover, this.rail, this.music, this.hats]) voice.dispose()
    this.ceremony.dispose()
    this.sfx.dispose()
    this.ui.dispose()
    this.bus.dispose()
    this.cache.clear()
  }

  /** Context time reaching the listener now, as sources schedule it (before the limiter's delay). */
  private heardNow(): number {
    const { ctx, clock } = this
    clock.currentTime = ctx.currentTime
    clock.outputLatency = ctx.outputLatency || ctx.baseLatency || 0
    clock.stamp = null
    if (typeof ctx.getOutputTimestamp === 'function') {
      const { contextTime, performanceTime } = ctx.getOutputTimestamp()
      if (contextTime !== undefined && performanceTime !== undefined) {
        this.stamp.contextTime = contextTime
        this.stamp.performanceTime = performanceTime
        clock.stamp = this.stamp
      }
    }
    return heardTime(clock, performance.now()) - LIMITER_LATENCY_SECONDS
  }

  private playSound(id: SoundId, options: OneShotOptions, pool: OneShotPool): void {
    const url = SOUNDS[id].url
    const buffer = this.cache.get(url)
    // A sound that is not decoded yet is skipped rather than played late; the load warms it for next time.
    if (buffer) pool.play(buffer, options)
    else void this.cache.load(url)
  }

  private phaseOf(layer: BedLayer): { anchor: number; loopSeconds: number } | null {
    const voice = this.beds[layer]
    return voice.anchor === null || voice.loopSeconds === null ? null : { anchor: voice.anchor, loopSeconds: voice.loopSeconds }
  }

  /** Starts a bed from its top, or in phase with `phase` when both loops are the same length. */
  private startBed({ layer, gain }: BedStart, phase: { anchor: number; loopSeconds: number } | null, fade: number): void {
    const track = BED_TRACKS[layer]
    const voice = this.beds[layer]
    void this.cache.load(track.url).then(buffer => {
      if (!buffer || SCENE_MIXES[this.scene].beds[layer] === 0 || voice.playing) return
      const when = this.ctx.currentTime + 0.02
      const aligned = phase !== null && Math.abs(phase.loopSeconds - track.loopSeconds) < 0.001
      voice.glideLevel(track.gain * gain, 0.005)
      voice.start(buffer, { when, offset: aligned ? loopPosition(when - phase.anchor, track.loopSeconds) : 0, loopSeconds: track.loopSeconds, fade })
    })
  }

  private stopBed(layer: BedLayer, fade: number): void {
    const track = BED_TRACKS[layer]
    this.beds[layer].stop(fade)
    if (track.loopSeconds > RELEASE_AFTER_SECONDS) {
      this.later(fade + 0.5, () => {
        if (SCENE_MIXES[this.scene].beds[layer] === 0) this.cache.release(track.url)
      })
    }
  }

  private stopRaceMusic(fade: number): void {
    const track = this.raceTrack
    this.raceMusic.stop(fade)
    this.raceTrack = null
    if (track) this.later(fade + 0.5, () => {
      if (this.raceTrack !== track) this.cache.release(track.url)
    })
  }

  private startRaceAmbience(fade: number): void {
    const layers: readonly (readonly [LoopVoice, TrackMeta])[] = [
      [this.wind, WIND],
      [this.hover, HOVER],
      [this.rail, RAIL],
    ]
    for (const [voice, track] of layers) {
      void this.cache.load(track.url).then(buffer => {
        if (!buffer || this.scene !== 'race' || voice.playing) return
        voice.start(buffer, { when: this.ctx.currentTime + 0.02, offset: 0, loopSeconds: track.loopSeconds, fade })
        this.applyAmbience(0.05)
      })
    }
  }

  private applyFlow(timeConstant: number): void {
    const mix = flowMix(this.flow)
    this.bus.shapeMusic(mix, timeConstant)
    this.hats.glideLevel(mix.hatGain * HAT_LEVEL, timeConstant)
    this.applyAmbience(timeConstant)
  }

  private applyAmbience(timeConstant: number): void {
    const speed = speedMix(this.speed)
    const boost = flowMix(this.flow).windBoost
    this.wind.glideLevel(WIND.gain * (speed.windGain + boost), timeConstant)
    this.wind.glideRate(speed.windRate, timeConstant)
    this.hover.glideLevel(HOVER.gain * speed.hoverGain, timeConstant)
    this.hover.glideRate(speed.hoverRate, timeConstant)
    this.rail.glideLevel(this.railing ? RAIL.gain : 0, timeConstant)
  }

  private impulseResponse(): AudioBuffer {
    this.impulse ??= toAudioBuffer(this.ctx, renderImpulse(this.ctx.sampleRate), this.ctx.sampleRate)
    return this.impulse
  }

  /** Runs synthesis steps in separate tasks, so preparing a scene never blocks a frame for long. */
  private renderOnePerTask(steps: readonly (() => void)[]): void {
    const [step, ...rest] = steps
    if (!step) return
    this.later(0, () => {
      step()
      this.renderOnePerTask(rest)
    })
  }

  private later(seconds: number, action: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      action()
    }, seconds * 1000)
    this.timers.add(timer)
  }
}
