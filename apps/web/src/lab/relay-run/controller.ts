import { relayRun } from '@nim-relay/game-engine'
import { parGhostTrace } from './ghost'

type RelayInputTrace = relayRun.RelayInputTrace
type RelayReplayConfig = relayRun.RelayReplayConfig
type RelayReplayResult = relayRun.RelayReplayResult
type RelayRunConfig = relayRun.RelayRunConfig
type RelayState = relayRun.RelayState
import { loadAggregate, RunInstruments, saveAggregate, type LabAggregate, type RunReport } from './instrumentation'

export type Phase = 'ready' | 'countdown' | 'playing' | 'sling-freeze' | 'results'

const TICK_MS = 1000 / 60
const KEYFRAME_TICKS = 30
const GHOST_KEY = 'nim-relay:lab:relay-run-v2:ghost'

const LAB_CONFIG: RelayRunConfig = {
  engineVersion: '2',
  challenge: 'relay-run',
  challengeVersion: '2',
  seed: 'lab-leg-alpha',
  legNumber: 4,
  sourceRegionId: 'aurora',
  destRegionId: 'canyon',
  prevLeg: null,
}

export interface Snapshot {
  phase: Phase
  countdown: number
  tick: number
  totalTicks: number
  state: RelayState
  ghost: RelayState | null
  ghostScore: number
  liveScore: number
  heatPct: number
  combo: number
  result: RelayReplayResult | null
  report: RunReport | null
  divergence: boolean
  ghostHidden: boolean
}

function readGhost(config: RelayRunConfig): RelayInputTrace {
  try {
    const raw = localStorage.getItem(GHOST_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as RelayInputTrace
    }
  } catch {
    /* fall through to par ghost */
  }
  return parGhostTrace({ ...config, inputTrace: [] } as RelayReplayConfig)
}

export class RelayRunController {
  readonly config = LAB_CONFIG
  readonly totalTicks = relayRun.totalTicks(LAB_CONFIG)
  private listeners = new Set<() => void>()
  private snap: Snapshot
  private published: Snapshot
  private ghostTrace: RelayInputTrace
  private ghostCursor: relayRun.RelayInputCursor
  private recorded: [number, number, 0 | 1][] = []
  private recSteer = 0
  private recPressed: 0 | 1 = 0
  private recLastTick = 0
  private steerQ = 0
  private pressed: 0 | 1 = 0
  private accumulator = 0
  private countdownMs = 3000
  private prevTime: number | null = null
  private publishAt = 0
  private instruments = new RunInstruments()
  private drawCalls = 0
  aggregate: LabAggregate = loadAggregate()
  ghostHidden = false
  private sawResultsSinceStart = false

  constructor() {
    this.ghostTrace = readGhost(this.config)
    this.ghostCursor = new relayRun.RelayInputCursor(this.ghostTrace)
    const fresh = relayRun.createRelayState(this.config)
    const ghostState = relayRun.createRelayState(this.config)
    this.snap = {
      phase: 'ready', countdown: 3, tick: 0, totalTicks: this.totalTicks,
      state: fresh, ghost: ghostState, ghostScore: 0, liveScore: 0,
      heatPct: 0, combo: 0, result: null, report: null, divergence: false, ghostHidden: this.ghostHidden,
    }
    this.published = { ...this.snap }
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = (): Snapshot => this.published
  getRenderSnapshot = (): Snapshot => this.snap
  get interpolation(): number {
    return Math.min(1, this.accumulator / TICK_MS)
  }

  private publish(): void {
    this.published = { ...this.snap, ghostHidden: this.ghostHidden }
    for (const fn of this.listeners) fn()
  }

  setSteer(normalized: number): void {
    const q = Math.max(-64, Math.min(64, Math.round(normalized * 64)))
    if (q !== this.steerQ) {
      this.steerQ = q
      this.instruments.markInputReceived()
    }
  }
  setPressed(down: boolean): void {
    const p: 0 | 1 = down ? 1 : 0
    if (p !== this.pressed) {
      this.pressed = p
      this.instruments.markInputReceived()
    }
  }
  toggleGhost(): void {
    this.ghostHidden = !this.ghostHidden
    this.publish()
  }

  start(voluntary: boolean): void {
    if (this.snap.phase === 'results' && voluntary && this.sawResultsSinceStart) this.aggregate.voluntaryReplays++
    if (this.snap.phase === 'playing' || this.snap.phase === 'countdown') this.aggregate.restarts++
    this.aggregate.runsStarted++
    saveAggregate(this.aggregate)

    this.ghostTrace = readGhost(this.config)
    this.ghostCursor = new relayRun.RelayInputCursor(this.ghostTrace)
    this.recorded = [[0, 0, 0]]
    this.recSteer = 0
    this.recPressed = 0
    this.recLastTick = 0
    this.steerQ = 0
    this.pressed = 0
    this.accumulator = 0
    this.countdownMs = 3000
    this.prevTime = null
    this.instruments = new RunInstruments()
    this.sawResultsSinceStart = false
    this.snap = {
      ...this.snap,
      phase: 'countdown', countdown: 3, tick: 0,
      state: relayRun.createRelayState(this.config),
      ghost: relayRun.createRelayState(this.config),
      ghostScore: 0, liveScore: 0, heatPct: 0, combo: 0, result: null, report: null, divergence: false,
    }
    this.publish()
  }

  measure(drawCalls: number): void {
    this.drawCalls = drawCalls
  }

  frame(now: number): void {
    const elapsed = this.prevTime === null ? 0 : now - this.prevTime
    this.prevTime = now

    if (this.snap.phase === 'countdown') {
      this.countdownMs -= elapsed
      this.snap.countdown = Math.max(1, Math.ceil(this.countdownMs / 1000))
      if (this.countdownMs <= 0) {
        this.snap.phase = 'playing'
        this.accumulator = -this.countdownMs
      }
      this.publish()
      return
    }
    if (this.snap.phase !== 'playing') return

    this.instruments.frame(elapsed, this.drawCalls)
    this.accumulator += elapsed

    while (this.accumulator >= TICK_MS && this.snap.state.tick < this.totalTicks) {
      const tick = this.snap.state.tick
      this.recordSample(tick)
      this.instruments.markInputApplied()
      this.snap.state = relayRun.stepRelay(this.snap.state, { steer: this.steerQ, pressed: this.pressed }, tick)
      if (this.snap.ghost && !this.ghostHidden) {
        const gi = this.ghostCursor.at(tick)
        this.snap.ghost = relayRun.stepRelay(this.snap.ghost, gi, tick)
      }
      this.accumulator -= TICK_MS
    }

    this.snap.tick = this.snap.state.tick
    this.snap.liveScore = relayRun.scoreRelayState(this.snap.state).score
    this.snap.heatPct = Math.round((this.snap.state.heat / 65536) * 100)
    this.snap.combo = this.snap.state.combo
    if (this.snap.ghost) {
      this.snap.ghostScore = relayRun.scoreRelayState(this.snap.ghost).score
      this.instruments.ghostDelta(this.snap.liveScore - this.snap.ghostScore)
    }

    if (this.snap.state.tick >= this.totalTicks) {
      this.finish()
      return
    }
    if (now - this.publishAt >= 33) {
      this.publishAt = now
      this.publish()
    }
  }

  private recordSample(tick: number): void {
    if (this.steerQ !== this.recSteer || this.pressed !== this.recPressed || tick - this.recLastTick >= KEYFRAME_TICKS) {
      const dt = tick - this.recLastTick
      if (tick === 0) this.recorded[0] = [0, this.steerQ, this.pressed]
      else this.recorded.push([dt, this.steerQ, this.pressed])
      this.recLastTick = tick
      this.recSteer = this.steerQ
      this.recPressed = this.pressed
    }
  }

  private finish(): void {
    const trace = this.recorded as RelayInputTrace
    const canonical = relayRun.replayRelayRun({ ...this.config, inputTrace: trace } as RelayReplayConfig)
    const live = relayRun.finalizeRelay(this.snap.state, trace)
    this.snap.divergence = live.resultHash !== canonical.resultHash
    this.snap.result = canonical

    const mods = relayRun.composeRoute(this.config.seed, this.config.legNumber, relayRun.deriveCarryState(this.config.prevLeg ?? null))
    const forkMod = mods.find((m) => m.kind === 'fork')
    const forkChoice: RunReport['forkChoice'] =
      this.snap.state.forkChoice === 0 ? 'none' : this.snap.state.forkTight === 1 ? 'tight' : 'wide'
    void forkMod

    const ghostResult: RunReport['ghostResult'] = this.ghostHidden
      ? 'no-ghost'
      : canonical.score >= this.snap.ghostScore
        ? 'won'
        : 'lost'

    this.snap.report = this.instruments.report({
      completed: true,
      score: canonical.score,
      ticks: this.totalTicks,
      forkChoice,
      redline: { greedyTicks: this.snap.state.metrics.greedyTicks, blowouts: this.snap.state.metrics.overheats },
      ghostResult,
      worstModule: this.snap.state.metrics.misses > 0 ? 'gate misses' : 'clean',
    })

    this.aggregate.runsCompleted++
    if (forkChoice === 'tight') this.aggregate.forkTight++
    if (forkChoice === 'wide') this.aggregate.forkWide++
    this.aggregate.scores.push(canonical.score)
    saveAggregate(this.aggregate)

    // persist this run as the next ghost
    try {
      localStorage.setItem(GHOST_KEY, JSON.stringify(trace))
    } catch {
      /* ignore */
    }

    this.snap.phase = 'results'
    this.sawResultsSinceStart = true
    this.publish()
  }
}
