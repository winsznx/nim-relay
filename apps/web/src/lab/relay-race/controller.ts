import { relayRace } from '@nim-relay/game-engine'
import { onboardingGhost } from './ghost'

type RaceState = relayRace.RaceState
type RaceInputTrace = relayRace.RaceInputTrace
type RaceReplayConfig = relayRace.RaceReplayConfig
type RaceReplayResult = relayRace.RaceReplayResult

const TICK_MS = 1000 / 60
const KEYFRAME_TICKS = 24
const GHOST_KEY = 'nim-relay:lab:relay-race-v3:ghost'

const CONFIG: relayRace.RaceConfig = { engineVersion: '3', challenge: 'relay-race', challengeVersion: '3', seed: 'lab-route-01' }

export type Phase = 'ready' | 'countdown' | 'racing' | 'handoff' | 'results'

export interface RunReport {
  completed: boolean
  timeSeconds: number
  frameMs: { mean: number; p50: number; p95: number; p99: number; worst: number; frames: number }
  triangles: number
  drawCalls: number
  inputLatencyMs: { mean: number; p95: number }
  fork: 'safe' | 'shortcut'
  boostControlPct: number
  ghostLeadChanges: number
  ghostResult: 'won' | 'lost'
}

export interface Snapshot {
  phase: Phase
  countdown: number
  state: RaceState
  ghost: RaceState
  ghostName: string
  progress: number // 0..1
  ghostProgress: number
  ghostDeltaSec: number // + = you ahead
  heatPct: number
  overheating: boolean
  boosting: boolean
  elapsedSec: number
  result: RaceReplayResult | null
  ghostResultSec: number
  report: RunReport | null
  divergence: boolean
}

function loadGhost(config: relayRace.RaceConfig): { trace: RaceInputTrace; name: string } {
  try {
    const raw = localStorage.getItem(GHOST_KEY)
    if (raw) {
      const p: unknown = JSON.parse(raw)
      if (Array.isArray(p) && p.length) return { trace: p as RaceInputTrace, name: 'Your last run' }
    }
  } catch {
    /* fall through */
  }
  return onboardingGhost({ ...config, inputTrace: [] } as unknown as RaceReplayConfig)
}

export class RaceController {
  readonly config = CONFIG
  private listeners = new Set<() => void>()
  private snap: Snapshot
  private published: Snapshot
  private ghostTrace: RaceInputTrace
  private ghostCursor: relayRace.RaceInputCursor
  private ghostResult: RaceReplayResult
  private recorded: [number, number, 0 | 1][] = []
  private recSteer = 0
  private recBoost: 0 | 1 = 0
  private recLast = 0
  private steerQ = 0
  private boost: 0 | 1 = 0
  private accumulator = 0
  private countdownMs = 3000
  private prevTime: number | null = null
  private publishAt = 0
  private handoffUntil = 0
  private frameTimes: number[] = []
  private latencies: number[] = []
  private pendingInputAt: number | null = null
  private lastLeadSign = 0
  private ghostLeadChanges = 0
  triangles = 0
  drawCalls = 0

  constructor() {
    const g = loadGhost(this.config)
    this.ghostTrace = g.trace
    this.ghostCursor = new relayRace.RaceInputCursor(g.trace)
    this.ghostResult = relayRace.replayRaceRun({ ...this.config, inputTrace: g.trace })
    const s = relayRace.createRaceState(this.config)
    this.snap = {
      phase: 'ready', countdown: 3, state: s, ghost: relayRace.createRaceState(this.config), ghostName: g.name,
      progress: 0, ghostProgress: 0, ghostDeltaSec: 0, heatPct: 0, overheating: false, boosting: false, elapsedSec: 0,
      result: null, ghostResultSec: this.ghostResult.timeSeconds, report: null, divergence: false,
    }
    this.published = { ...this.snap }
  }

  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  getSnapshot = (): Snapshot => this.published
  getRenderSnapshot = (): Snapshot => this.snap
  get interpolation(): number { return Math.min(1, this.accumulator / TICK_MS) }
  private publish(): void { this.published = { ...this.snap }; for (const fn of this.listeners) fn() }

  setSteer(n: number): void {
    const q = Math.max(-64, Math.min(64, Math.round(n * 64)))
    if (q !== this.steerQ) { this.steerQ = q; this.pendingInputAt ??= performance.now() }
  }
  setBoost(down: boolean): void {
    const b: 0 | 1 = down ? 1 : 0
    if (b !== this.boost) { this.boost = b; this.pendingInputAt ??= performance.now() }
  }
  measure(triangles: number, drawCalls: number): void { this.triangles = triangles; this.drawCalls = drawCalls }

  start(): void {
    const g = loadGhost(this.config)
    this.ghostTrace = g.trace
    this.ghostCursor = new relayRace.RaceInputCursor(g.trace)
    this.ghostResult = relayRace.replayRaceRun({ ...this.config, inputTrace: g.trace })
    this.recorded = [[0, 0, 0]]
    this.recSteer = 0; this.recBoost = 0; this.recLast = 0
    this.steerQ = 0; this.boost = 0
    this.accumulator = 0; this.countdownMs = 3000; this.prevTime = null
    this.frameTimes = []; this.latencies = []; this.pendingInputAt = null
    this.lastLeadSign = 0; this.ghostLeadChanges = 0
    this.snap = {
      ...this.snap, phase: 'countdown', countdown: 3,
      state: relayRace.createRaceState(this.config), ghost: relayRace.createRaceState(this.config), ghostName: g.name,
      progress: 0, ghostProgress: 0, ghostDeltaSec: 0, heatPct: 0, overheating: false, boosting: false, elapsedSec: 0,
      result: null, ghostResultSec: this.ghostResult.timeSeconds, report: null, divergence: false,
    }
    this.publish()
  }

  frame(now: number): void {
    const elapsed = this.prevTime === null ? 0 : now - this.prevTime
    this.prevTime = now

    if (this.snap.phase === 'countdown') {
      this.countdownMs -= elapsed
      this.snap.countdown = Math.max(1, Math.ceil(this.countdownMs / 1000))
      if (this.countdownMs <= 0) { this.snap.phase = 'racing'; this.accumulator = -this.countdownMs }
      this.publish()
      return
    }
    if (this.snap.phase === 'handoff') {
      if (now >= this.handoffUntil) { this.snap.phase = 'results'; this.publish() }
      return
    }
    if (this.snap.phase !== 'racing') return

    if (elapsed > 0 && elapsed < 500) this.frameTimes.push(elapsed)
    this.accumulator += elapsed

    const finishTicks = this.ghostResult.ticks
    void finishTicks
    while (this.accumulator >= TICK_MS && this.snap.state.finished === 0) {
      const tick = this.snap.state.tick
      this.recordSample(tick)
      if (this.pendingInputAt !== null) { this.latencies.push(performance.now() - this.pendingInputAt); this.pendingInputAt = null }
      this.snap.state = relayRace.stepRace(this.snap.state, { steer: this.steerQ, boost: this.boost }, tick)
      if (this.snap.ghost.finished === 0) {
        this.snap.ghost = relayRace.stepRace(this.snap.ghost, this.ghostCursor.at(tick), tick)
      }
      this.accumulator -= TICK_MS
    }

    const s = this.snap.state
    const fin = s.track.finishDist
    this.snap.progress = Math.min(1, s.dist / fin)
    this.snap.ghostProgress = Math.min(1, this.snap.ghost.dist / fin)
    this.snap.elapsedSec = Math.round((s.tick / 60) * 100) / 100
    this.snap.heatPct = Math.round((s.heat / 65536) * 100)
    this.snap.overheating = s.overheatTicks > 0
    this.snap.boosting = s.boosting === 1 && s.overheatTicks === 0
    // ghost delta in seconds: compare tick at equal progress (approx via distance ratio)
    const gAheadDist = this.snap.ghost.dist - s.dist
    const speedPerTick = Math.max(1, s.speed)
    this.snap.ghostDeltaSec = Math.round((-gAheadDist / speedPerTick / 60) * 100) / 100
    const sign = this.snap.ghostDeltaSec > 0.05 ? 1 : this.snap.ghostDeltaSec < -0.05 ? -1 : 0
    if (sign !== 0 && this.lastLeadSign !== 0 && sign !== this.lastLeadSign) this.ghostLeadChanges++
    if (sign !== 0) this.lastLeadSign = sign

    if (s.finished === 1) { this.finish(); return }
    if (now - this.publishAt >= 33) { this.publishAt = now; this.publish() }
  }

  private recordSample(tick: number): void {
    if (this.steerQ !== this.recSteer || this.boost !== this.recBoost || tick - this.recLast >= KEYFRAME_TICKS) {
      if (tick === 0) this.recorded[0] = [0, this.steerQ, this.boost]
      else this.recorded.push([tick - this.recLast, this.steerQ, this.boost])
      this.recLast = tick
      this.recSteer = this.steerQ
      this.recBoost = this.boost
    }
  }

  private finish(): void {
    const trace = this.recorded as RaceInputTrace
    const canonical = relayRace.replayRaceRun({ ...this.config, inputTrace: trace })
    const live = relayRace.finalizeRace(this.snap.state, trace)
    this.snap.divergence = live.resultHash !== canonical.resultHash
    this.snap.result = canonical

    const sorted = [...this.frameTimes].sort((a, b) => a - b)
    const lat = [...this.latencies].sort((a, b) => a - b)
    const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0)
    const pct = (xs: number[], p: number): number => xs[Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1))] ?? 0
    const r2 = (n: number): number => Math.round(n * 100) / 100
    this.snap.report = {
      completed: canonical.finished,
      timeSeconds: canonical.timeSeconds,
      frameMs: { mean: r2(mean(sorted)), p50: r2(pct(sorted, 50)), p95: r2(pct(sorted, 95)), p99: r2(pct(sorted, 99)), worst: r2(sorted.at(-1) ?? 0), frames: sorted.length },
      triangles: this.triangles,
      drawCalls: this.drawCalls,
      inputLatencyMs: { mean: r2(mean(lat)), p95: r2(pct(lat, 95)) },
      fork: this.snap.state.onShortcut === 1 ? 'shortcut' : 'safe',
      boostControlPct: canonical.boostControlPct,
      ghostLeadChanges: this.ghostLeadChanges,
      ghostResult: canonical.timeMs <= this.ghostResult.timeMs ? 'won' : 'lost',
    }

    try { localStorage.setItem(GHOST_KEY, JSON.stringify(trace)) } catch { /* ignore */ }

    this.snap.phase = 'handoff'
    this.handoffUntil = performance.now() + 2400
    this.publish()
  }
}
