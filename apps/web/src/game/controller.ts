import { createState, step, resultForState, replay, totalTicks, inputAtTick, ENGINE_VERSION, type ChallengeId, type InputTrace, type RunConfig } from '@nim-relay/game-engine'

export type SimState = ReturnType<typeof createState>
export type RunResult = ReturnType<typeof replay>
export type Phase = 'ready' | 'countdown' | 'playing' | 'paused' | 'results'
export interface FrameMetrics { frames: number; averageMs: number; p95Ms: number; maxDrawCalls: number; durationMs: number; dpr: number; renderer: string }
export interface Snapshot {
  phase: Phase
  countdown: number
  state: SimState
  held: boolean
  ghost: SimState | null
  ghostScore: number | null
  result: RunResult | null
  trace: InputTrace
  metrics: FrameMetrics
}
const configFor = (challenge: ChallengeId): RunConfig => ({ engineVersion: ENGINE_VERSION, challenge, challengeVersion: '1.0.0', seed: 'nim-relay-solo-1', difficulty: 3, durationMs: 20_000 })
const storageKey = (challenge: ChallengeId) => `nim-relay:solo:1:${challenge}`

function loadGhost(config: RunConfig): { trace: InputTrace; score: number } | null {
  try {
    const raw = localStorage.getItem(storageKey(config.challenge))
    if (!raw || raw.length > 100_000) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const trace: [number, 0 | 1][] = []
    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'number' || (entry[1] !== 0 && entry[1] !== 1)) return null
      trace.push([entry[0], entry[1]])
    }
    return { trace, score: replay({ ...config, inputTrace: trace }).score }
  } catch {
    // A malformed or unavailable local replay must never prevent a new run.
    return null
  }
}

export class GameController {
  readonly config: RunConfig
  private listeners = new Set<() => void>()
  private pointers = new Set<number>()
  private keyboardHeld = false
  private trace: [number, 0 | 1][] = []
  private ghostTrace: InputTrace | null
  private frameTimes: number[] = []
  private accumulator = 0
  private countdownMs = 3000
  private previousTime: number | null = null
  private publishAt = 0
  private resumePhase: 'countdown' | 'playing' = 'playing'
  private snapshot: Snapshot
  private published: Snapshot
  private previousState: SimState

  constructor(challenge: ChallengeId) {
    this.config = configFor(challenge)
    const ghost = loadGhost(this.config)
    this.ghostTrace = ghost?.trace ?? null
    this.snapshot = {
      phase: 'ready', countdown: 3, state: createState(this.config), held: false,
      ghost: ghost ? createState(this.config) : null, ghostScore: ghost?.score ?? null,
      result: null, trace: [],
      metrics: { frames: 0, averageMs: 0, p95Ms: 0, maxDrawCalls: 0, durationMs: 0, dpr: 1, renderer: 'initializing' },
    }
    this.published = { ...this.snapshot, metrics: { ...this.snapshot.metrics } }
    this.previousState = this.snapshot.state
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.published
  getRenderSnapshot = () => this.snapshot
  getPreviousState = () => this.previousState
  private publish() { this.published = { ...this.snapshot, trace: [...this.trace], metrics: { ...this.snapshot.metrics } }; for (const listener of this.listeners) listener() }
  private clearInput() { this.pointers.clear(); this.keyboardHeld = false; this.snapshot.held = false }
  pointer(id: number, down: boolean) {
    if (this.snapshot.phase !== 'playing') return
    if (down) this.pointers.add(id); else this.pointers.delete(id)
    this.snapshot.held = this.keyboardHeld || this.pointers.size > 0
    this.publish()
  }
  keyboard(down: boolean) {
    if (this.snapshot.phase !== 'playing') return
    this.keyboardHeld = down
    this.snapshot.held = down || this.pointers.size > 0
    this.publish()
  }
  start = () => {
    const ghost = loadGhost(this.config)
    this.ghostTrace = ghost?.trace ?? null
    this.clearInput(); this.trace = []; this.frameTimes = []; this.accumulator = 0; this.countdownMs = 3000; this.previousTime = null
    this.snapshot = { ...this.snapshot, phase: 'countdown', countdown: 3, state: createState(this.config), ghost: ghost ? createState(this.config) : null, ghostScore: ghost?.score ?? null, result: null, metrics: { ...this.snapshot.metrics, frames: 0, averageMs: 0, p95Ms: 0, durationMs: 0, maxDrawCalls: 0 } }
    this.previousState = this.snapshot.state
    this.publish()
  }
  pause = () => {
    if (this.snapshot.phase !== 'playing' && this.snapshot.phase !== 'countdown') return
    this.resumePhase = this.snapshot.phase; this.clearInput(); this.snapshot.phase = 'paused'; this.previousTime = null; this.publish()
  }
  resume = () => { if (this.snapshot.phase === 'paused') { this.clearInput(); this.snapshot.phase = this.resumePhase; this.previousTime = null; this.publish() } }
  frame(now: number) {
    const elapsed = this.previousTime === null ? 0 : now - this.previousTime
    this.previousTime = now
    if (this.snapshot.phase === 'countdown') {
      this.countdownMs -= elapsed
      this.snapshot.countdown = Math.max(1, Math.ceil(this.countdownMs / 1000))
      if (this.countdownMs <= 0) { this.snapshot.phase = 'playing'; this.accumulator = -this.countdownMs }
      this.publish()
      return
    }
    if (this.snapshot.phase !== 'playing') return
    if (elapsed > 0) this.frameTimes.push(elapsed)
    this.accumulator += elapsed
    // No elapsed time is discarded: display cadence cannot change the canonical tick count.
    while (this.accumulator >= 1000 / 60 && this.snapshot.state.tick < totalTicks(this.config)) {
      const state = this.snapshot.state
      const input = this.snapshot.held ? 1 : 0
      if (input !== state.lastInput) this.trace.push([Math.floor(state.tick * 1000 / 60), input])
      this.previousState = state
      this.snapshot.state = step(state, input, state.tick)
      if (this.snapshot.ghost && this.ghostTrace) this.snapshot.ghost = step(this.snapshot.ghost, inputAtTick(this.ghostTrace, state.tick), state.tick)
      this.accumulator -= 1000 / 60
    }
    if (this.snapshot.state.tick === totalTicks(this.config)) {
      const result = replay({ ...this.config, inputTrace: this.trace })
      if (result.resultHash !== resultForState(this.snapshot.state, this.trace).resultHash) throw new Error('Live simulation and canonical replay diverged')
      this.snapshot.result = result
      this.snapshot.phase = 'results'; this.clearInput()
      const sorted = [...this.frameTimes].sort((a, b) => a - b)
      const durationMs = this.frameTimes.reduce((sum, value) => sum + value, 0)
      this.snapshot.metrics = { ...this.snapshot.metrics, frames: sorted.length, durationMs, averageMs: durationMs / Math.max(1, sorted.length), p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0 }
      try { localStorage.setItem(storageKey(this.config.challenge), JSON.stringify(this.trace)) } catch { /* Private WebViews may disable storage; the current run remains playable. */ }
      this.publish()
    } else if (now - this.publishAt >= 80) { this.publishAt = now; this.publish() }
  }
  measure(drawCalls: number, dpr: number, renderer: string) {
    if (this.snapshot.phase === 'playing') this.snapshot.metrics.maxDrawCalls = Math.max(this.snapshot.metrics.maxDrawCalls, drawCalls)
    this.snapshot.metrics.dpr = dpr; this.snapshot.metrics.renderer = renderer
  }
  get interpolation() { return Math.min(1, this.accumulator / (1000 / 60)) }
}
