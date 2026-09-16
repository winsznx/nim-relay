import { stationRace } from '@nim-relay/game-engine'

export type Phase = 'ready' | 'countdown' | 'racing' | 'paused' | 'handoff' | 'launch' | 'results'
export interface Snapshot {
  phase: Phase; countdown: number; state: stationRace.State; ghost: stationRace.State | null; ghostName: string | null
  ghostDeltaSeconds: number | null; result: stationRace.Result | null; trace: stationRace.InputTrace
  frameMetrics: { frames: number; totalMs: number; worstMs: number }; divergence: boolean
}
export interface Ghost { trace: stationRace.InputTrace; name: string }
const TICK_MS = 1000 / 60
export class StationController {
  private throwParameters = { angle: 45, power: 75 }
  getThrow = () => this.throwParameters
  commitThrow(angle: number, power: number): void {
    if (this.snap.phase !== 'handoff' || !Number.isInteger(angle) || angle < 15 || angle > 75 || !Number.isInteger(power) || power < 30 || power > 100) throw new RangeError('Invalid throw')
    this.throwParameters = { angle, power }
  }
  private snap: Snapshot
  private published: Snapshot
  private listeners = new Set<() => void>()
  private recorded: stationRace.Sample[] = []
  private ghostCursor: stationRace.InputCursor | null = null
  private ghostDistances: number[] = []
  private ghostResult: stationRace.Result | null = null
  private ghostDistanceIndex = 0
  private input: stationRace.Input = { steer: 0, boost: 0, action: 0 }
  private lastSampleTick = 0
  private lastTime: number | null = null
  private accumulator = 0
  private countdownMs = 3000
  private launchMs = 0
  private resumePhase: 'countdown' | 'racing' = 'racing'
  private playbackCursor: stationRace.InputCursor | null = null
  get isPlayback(): boolean { return this.playback !== undefined }
  constructor(readonly config: stationRace.Config, private readonly opponent?: Ghost, private readonly playback?: { playbackTrace: stationRace.InputTrace }) {
    if (playback) stationRace.replay({ ...config, inputTrace: playback.playbackTrace })
    if (opponent) {
      this.ghostResult = stationRace.replay({ ...config, inputTrace: opponent.trace })
      let ghost = stationRace.createState(config)
      const cursor = new stationRace.InputCursor(opponent.trace)
      this.ghostDistances.push(0)
      while (!ghost.finished) { ghost = stationRace.step(ghost, cursor.at(ghost.tick)); this.ghostDistances.push(ghost.dist) }
    }
    this.snap = this.initial()
    this.published = this.snap
  }
  private initial(): Snapshot {
    this.playbackCursor = this.playback ? new stationRace.InputCursor(this.playback.playbackTrace) : null
    this.ghostCursor = this.opponent ? new stationRace.InputCursor(this.opponent.trace) : null
    return { phase: 'ready', countdown: 3, state: stationRace.createState(this.config), ghost: this.opponent ? stationRace.createState(this.config) : null, ghostName: this.opponent?.name ?? null, ghostDeltaSeconds: this.opponent ? 0 : null, result: null, trace: [], frameMetrics: { frames: 0, totalMs: 0, worstMs: 0 }, divergence: false }
  }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = (): Snapshot => this.published
  snapshot = (): Snapshot => this.snap
  getRenderSnapshot = (): Snapshot => this.snap
  private publish(): void { this.published = { ...this.snap }; for (const listener of this.listeners) listener() }
  setSteer(value: number): void { if (Number.isFinite(value)) this.input.steer = Math.max(-64, Math.min(64, Math.round(value))) }
  setBoost(value: boolean): void { this.input.boost = value ? 1 : 0 }
  jump(): void { if (this.snap.phase === 'racing') this.input.action = 1 }
  duck(): void { if (this.snap.phase === 'racing') this.input.action = 2 }
  start(): void {
    this.snap = this.initial(); this.snap.phase = 'countdown'; this.recorded = []; this.input = { steer: 0, boost: 0, action: 0 }
    this.lastSampleTick = 0; this.lastTime = null; this.accumulator = 0; this.countdownMs = 3000; this.ghostDistanceIndex = 0; this.publish()
  }
  pause(): void {
    if (this.snap.phase !== 'racing' && this.snap.phase !== 'countdown') return
    this.resumePhase = this.snap.phase; this.snap.phase = 'paused'; this.input.boost = 0; this.input.action = 0; this.lastTime = null; this.publish()
  }
  resume(): void { if (this.snap.phase === 'paused') { this.snap.phase = this.resumePhase; this.lastTime = null; this.publish() } }
  /** Caller must supply a verified settlement reference, or explicitly finish a practice run. */
  launch(authorization: { practice: true } | { verifiedTransactionHash: string }): void {
    if (this.snap.phase !== 'handoff' || this.snap.divergence || !this.snap.result?.completed) return
    if (!('practice' in authorization) && !/^[a-f0-9]{64}$/i.test(authorization.verifiedTransactionHash)) throw new RangeError('Verified transaction required')
    this.snap.phase = 'launch'; this.launchMs = 0; this.lastTime = null; this.publish()
  }
  frame(now: number): Snapshot {
    if (!Number.isFinite(now)) return this.snap
    let elapsed = this.lastTime === null ? 0 : Math.max(0, now - this.lastTime)
    this.lastTime = now
    if (this.snap.phase === 'countdown') {
      this.countdownMs -= elapsed; this.snap.countdown = Math.max(0, Math.ceil(this.countdownMs / 1000))
      if (this.countdownMs <= 0) { this.snap.phase = 'racing'; elapsed = -this.countdownMs } else { this.publish(); return this.snap }
    }
    if (this.snap.phase === 'launch') { this.launchMs += elapsed; if (this.launchMs >= 4200) this.snap.phase = 'results'; this.publish(); return this.snap }
    if (this.snap.phase !== 'racing') return this.snap
    this.snap.frameMetrics = { frames: this.snap.frameMetrics.frames + 1, totalMs: this.snap.frameMetrics.totalMs + elapsed, worstMs: Math.max(this.snap.frameMetrics.worstMs, elapsed) }
    this.accumulator += elapsed
    while (this.accumulator + 0.000001 >= TICK_MS && !this.snap.state.finished) {
      const tick = this.snap.state.tick
      if (this.playbackCursor) this.input = { ...this.playbackCursor.at(tick) }
      const previous = this.recorded.at(-1)
      if (!previous || previous[1] !== this.input.steer || previous[2] !== this.input.boost || this.input.action !== 0 || tick - this.lastSampleTick >= 24) {
        this.recorded.push([tick - this.lastSampleTick, this.input.steer, this.input.boost, this.input.action]); this.lastSampleTick = tick
      }
      this.snap.state = stationRace.step(this.snap.state, this.input)
      this.input.action = 0
      if (this.snap.ghost && this.ghostCursor && !this.snap.ghost.finished) this.snap.ghost = stationRace.step(this.snap.ghost, this.ghostCursor.at(tick))
      this.accumulator -= TICK_MS
    }
    if (this.ghostResult) {
      while (this.ghostDistanceIndex + 1 < this.ghostDistances.length && this.ghostDistances[this.ghostDistanceIndex + 1]! <= this.snap.state.dist) this.ghostDistanceIndex++
      this.snap.ghostDeltaSeconds = (this.snap.state.tick - this.ghostDistanceIndex) / 60
    }
    if (this.snap.state.finished) {
      this.snap.trace = (this.playback?.playbackTrace ?? this.recorded).map(sample => [...sample])
      const live = stationRace.finalize(this.snap.state, this.snap.trace)
      const replayed = stationRace.replay({ ...this.config, inputTrace: this.snap.trace })
      this.snap.divergence = live.resultHash !== replayed.resultHash; this.snap.result = replayed; this.snap.phase = replayed.completed && !this.isPlayback ? 'handoff' : 'results'
    }
    this.publish(); return this.snap
  }
}
