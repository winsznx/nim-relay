import { relayLeg } from '@nim-relay/game-engine'
import { CUES, CueGate, planEventCues, type CueName, type NamedCue } from './cues'
import { AudioEngine } from './engine'
import { vibrate, type HapticKind } from './haptics'
import { FlowRise } from './mix'
import { browserStorage, readMuted, writeMuted, type StorageAccess } from './preferences'
import type { CeremonyStage, SceneKind } from './scenes'

export type { CeremonyStage, SceneKind } from './scenes'
export type { NamedCue } from './cues'
export type { HapticKind } from './haptics'

/**
 * unavailable: no Web Audio here; every call is a silent no-op.
 * locked: waiting for a user gesture before any sound may start.
 * running: audible (unless muted).
 * suspended: paused by the page being hidden, by mute, or by the system (a call, another app).
 */
export type AudioStatus = 'unavailable' | 'locked' | 'running' | 'suspended'

export interface AudioSnapshot {
  readonly muted: boolean
  readonly status: AudioStatus
}

export interface AudioDirectorOptions {
  storage?: StorageAccess
  /** Returns null when Web Audio is unavailable. */
  createContext?: () => AudioContext | null
  random?: () => number
}

const GESTURE_EVENTS = ['pointerup', 'touchend', 'click', 'keydown'] as const
/** Mute fades the master out before suspending the context, so it never cuts off mid-waveform. */
const MUTE_SUSPEND_MS = 150

function browserContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null
  try {
    return new window.AudioContext({ latencyHint: 'interactive' })
  } catch (error) {
    console.warn('Web Audio is unavailable', error)
    return null
  }
}

/**
 * NIM Relay's sound, as one object the app talks to. It owns the AudioContext's life (created
 * and resumed only from a user gesture, suspended while hidden or muted, recovered after iOS
 * interruptions such as the Nimiq Pay approval sheet), the mute choice, and cue rate limiting;
 * the AudioEngine behind it does the mixing. Every method is safe to call at any time, in any
 * order, before unlock, and where Web Audio does not exist.
 */
export class AudioDirector {
  private ctx: AudioContext | null = null
  private engine: AudioEngine | null = null
  private readonly available: boolean
  private readonly storage: StorageAccess
  private readonly makeContext: () => AudioContext | null
  private readonly random: () => number
  private readonly gate = new CueGate()
  private readonly flowRise = new FlowRise()
  private rush = false
  private readonly listeners = new Set<() => void>()
  private readonly warned = new Set<string>()
  private snapshot: AudioSnapshot
  private mutedValue: boolean
  private sceneKind: SceneKind = 'silent'
  private raceWorld: relayLeg.World | null = null
  private hidden = false
  private unlocked = false
  private disposed = false
  private gesturesArmed = false
  private suspendTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: AudioDirectorOptions = {}) {
    this.storage = options.storage ?? browserStorage
    this.makeContext = options.createContext ?? browserContext
    this.random = options.random ?? Math.random
    this.available = options.createContext !== undefined || (typeof window !== 'undefined' && typeof window.AudioContext === 'function')
    this.mutedValue = readMuted(this.storage)
    this.snapshot = { muted: this.mutedValue, status: this.available ? 'locked' : 'unavailable' }
    if (this.available && typeof document !== 'undefined') {
      this.hidden = document.visibilityState === 'hidden'
      document.addEventListener('visibilitychange', this.onVisibility)
      this.armGestures()
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): AudioSnapshot => this.snapshot

  get muted(): boolean {
    return this.mutedValue
  }

  /**
   * Creates or resumes the AudioContext. Call it from a user gesture (a tap); the director also
   * listens for the first gesture itself. Safe to call repeatedly.
   */
  unlock(): Promise<void> {
    if (this.disposed || !this.available || this.mutedValue) return Promise.resolve()
    if (!this.ctx) this.createEngine()
    return this.resume()
  }

  setMuted(muted: boolean): void {
    if (this.disposed || muted === this.mutedValue) return
    this.mutedValue = muted
    writeMuted(this.storage, muted)
    this.guard('mute', () => this.engine?.setMuted(muted))
    if (!muted && !this.ctx) void this.unlock()
    this.updateRunState()
    this.publish()
  }

  /** Crossfades to the scene's beds. Scenes set before unlock start with the first gesture. */
  scene(kind: SceneKind): void {
    if (this.disposed || kind === this.sceneKind) return
    const from = this.sceneKind
    this.sceneKind = kind
    if (kind !== 'race') this.raceWorld = null
    this.guard('scene', () => this.engine?.applyScene(from, kind))
  }

  /** Enters the race scene and arms the world's track. Its beat 0 lands on the race's tick 0. */
  startRace({ world }: { world: relayLeg.World }): void {
    if (this.disposed) return
    this.scene('race')
    this.raceWorld = world
    this.gate.reset()
    this.flowRise.reset()
    this.setRush(false)
    this.guard('startRace', () => this.engine?.prepareRace(world))
  }

  /**
   * Call every animation frame while racing with the tick on screen (fractional ticks are fine)
   * and whether the race clock is running. Pausing stops the music; resuming restarts it at the
   * matching loop position. A negative tick with `running` plays the loop's tail as a count-in.
   */
  syncRace(tick: number, running: boolean): void {
    const engine = this.engine
    if (!engine || this.ctx?.state !== 'running' || !Number.isFinite(tick)) return
    this.guard('syncRace', () => engine.syncRace(tick, running))
  }

  /**
   * FLOW 0..1: low filters the music, high adds the hat layer and width. Climbing into the mid or
   * high tier plays the rise cue, in step with the HUD and the scene.
   */
  setFlow(flow: number): void {
    this.guard('setFlow', () => this.engine?.setFlow(flow))
    if (!Number.isFinite(flow)) return
    // Relay Rush pins FLOW at full, so FLOW below full means the rush is over (run out, hit or fall).
    if (this.rush && flow < 1) this.setRush(false)
    if (this.flowRise.update(flow) && this.sceneKind === 'race' && !this.rush) this.cueNamed('flow-rise')
  }

  /** Relay Rush intensity. The director also starts it on RUSH_START and ends it when FLOW leaves full. */
  setRush(active: boolean): void {
    if (this.disposed || active === this.rush) return
    this.rush = active
    this.guard('setRush', () => this.engine?.setRush(active))
  }

  /** Speed 0..1: wind level and pitch, hover hum pitch. */
  setSpeed(speed: number): void {
    this.guard('setSpeed', () => this.engine?.setSpeed(speed))
  }

  setRailing(railing: boolean): void {
    this.guard('setRailing', () => this.engine?.setRailing(railing))
  }

  /** Plays the cues of a relayLeg.EVENT bit mask, rate limited per cue. */
  cue(eventMask: number): void {
    if (Number.isInteger(eventMask) && eventMask & relayLeg.EVENT.RUSH_START) this.setRush(true)
    if (!this.audible() || !Number.isInteger(eventMask) || eventMask <= 0) return
    const now = this.ctx?.currentTime ?? 0
    for (const name of planEventCues(eventMask, now, this.gate)) this.play(name)
  }

  cueNamed(name: NamedCue): void {
    if (!this.audible() || !this.gate.allow(name, this.ctx?.currentTime ?? 0)) return
    this.play(name)
  }

  /**
   * Handoff ceremony stage. Suggested mapping from the handoff machine: aiming or preparing ->
   * approach, armed -> armed, wallet (approval open) -> frozen, confirmed -> launch, then
   * departed while the baton travels and arrival when the next runner receives it.
   */
  ceremony(stage: CeremonyStage): void {
    if (this.disposed) return
    this.scene('ceremony')
    this.guard('ceremony', () => this.engine?.enterCeremony(stage, this.audible()))
  }

  /** Vibrates where supported (Android); a no-op on iOS and while muted. */
  haptic(kind: HapticKind): boolean {
    return !this.disposed && !this.mutedValue && vibrate(kind)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disarmGestures()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility)
    if (this.suspendTimer) clearTimeout(this.suspendTimer)
    this.guard('dispose', () => this.engine?.dispose())
    this.engine = null
    const ctx = this.ctx
    this.ctx = null
    if (ctx) {
      ctx.removeEventListener('statechange', this.onStateChange)
      ctx.close().catch((error: unknown) => this.warn('close', error))
    }
    this.listeners.clear()
    if (instance === this) instance = null
  }

  private createEngine(): void {
    const ctx = this.makeContext()
    if (!ctx) return
    this.ctx = ctx
    ctx.addEventListener('statechange', this.onStateChange)
    this.guard('unlock', () => {
      const engine = new AudioEngine(ctx, this.random, kind => this.haptic(kind))
      this.engine = engine
      engine.setMuted(this.mutedValue)
      engine.applyScene('silent', this.sceneKind)
      if (this.sceneKind === 'race' && this.raceWorld) engine.prepareRace(this.raceWorld)
      // iOS routes Web Audio only after something has started inside the gesture.
      const primer = ctx.createBufferSource()
      primer.buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
      primer.connect(ctx.destination)
      primer.start()
    })
  }

  private resume(): Promise<void> {
    const ctx = this.ctx
    if (!ctx || this.disposed) return Promise.resolve()
    if (ctx.state === 'running') {
      this.onStateChange()
      return Promise.resolve()
    }
    // Resuming outside a gesture can stay pending (iOS) or reject; the next gesture retries.
    this.armGestures()
    return ctx.resume().then(this.onStateChange, (error: unknown) => this.warn('resume', error))
  }

  /** Running while visible and unmuted; otherwise faded out and suspended to save battery. */
  private updateRunState(): void {
    const ctx = this.ctx
    if (!ctx || this.disposed) return
    if (this.suspendTimer) clearTimeout(this.suspendTimer)
    this.suspendTimer = null
    if (!this.hidden && !this.mutedValue) {
      if (ctx.state !== 'running') void this.resume()
      return
    }
    if (ctx.state !== 'running') return
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null
      if (this.hidden || this.mutedValue) ctx.suspend().catch((error: unknown) => this.warn('suspend', error))
    }, this.hidden ? 0 : MUTE_SUSPEND_MS)
  }

  private readonly onVisibility = (): void => {
    this.hidden = document.visibilityState === 'hidden'
    this.updateRunState()
  }

  /** Also covers WebKit's 'interrupted' state, entered when the system takes the audio session. */
  private readonly onStateChange = (): void => {
    const state: string = this.ctx?.state ?? 'closed'
    if (state === 'running') {
      this.unlocked = true
      this.disarmGestures()
      if (this.hidden || this.mutedValue) this.updateRunState()
    } else if (state !== 'closed' && !this.hidden && !this.mutedValue) {
      this.armGestures()
    }
    this.publish()
  }

  private readonly onGesture = (): void => {
    void this.unlock()
  }

  private armGestures(): void {
    if (this.gesturesArmed || this.disposed || typeof document === 'undefined') return
    this.gesturesArmed = true
    for (const type of GESTURE_EVENTS) document.addEventListener(type, this.onGesture, { capture: true, passive: true })
  }

  private disarmGestures(): void {
    if (!this.gesturesArmed || typeof document === 'undefined') return
    this.gesturesArmed = false
    for (const type of GESTURE_EVENTS) document.removeEventListener(type, this.onGesture, { capture: true })
  }

  private audible(): boolean {
    return !this.disposed && !this.mutedValue && this.engine !== null && this.ctx?.state === 'running'
  }

  private play(name: CueName): void {
    this.guard('cue', () => this.engine?.playCue(name))
    const haptic = CUES[name].haptic
    if (haptic) vibrate(haptic)
  }

  private publish(): void {
    const ctx = this.ctx
    const status: AudioStatus = !this.available ? 'unavailable' : !ctx || !this.unlocked ? 'locked' : ctx.state === 'running' ? 'running' : 'suspended'
    if (status === this.snapshot.status && this.mutedValue === this.snapshot.muted) return
    this.snapshot = { muted: this.mutedValue, status }
    for (const listener of this.listeners) listener()
  }

  /** Sound must never take the game down: a Web Audio failure is reported once and skipped. */
  private guard(label: string, action: () => void): void {
    try {
      action()
    } catch (error) {
      this.warn(label, error)
    }
  }

  private warn(label: string, error: unknown): void {
    if (this.warned.has(label)) return
    this.warned.add(label)
    console.warn(`Audio ${label} failed`, error)
  }
}

let instance: AudioDirector | null = null

/** The app-wide director. */
export function getAudioDirector(): AudioDirector {
  instance ??= new AudioDirector()
  return instance
}

// Hot reloads re-run this module; close the old context instead of leaking one per edit.
import.meta.hot?.dispose(() => instance?.dispose())
