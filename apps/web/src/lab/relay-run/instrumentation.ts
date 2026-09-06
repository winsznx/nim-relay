/**
 * Game-quality instrumentation for the Phase 3.6 slice (docs/RELAY_GAME_V2.md
 * §9.5). Client-side only; aggregate persisted to localStorage, current run
 * emitted as JSON for capture. Not sent anywhere.
 */

export interface RunReport {
  completed: boolean
  score: number
  ticks: number
  durationMs: number
  frameMs: { mean: number; p50: number; p95: number; p99: number; worst: number; frames: number }
  maxDrawCalls: number
  inputLatencyMs: { mean: number; p95: number; samples: number }
  forkChoice: 'wide' | 'tight' | 'none'
  redline: { greedyTicks: number; blowouts: number }
  ghostLeadChanges: number
  ghostResult: 'won' | 'lost' | 'no-ghost'
  worstModule: string
}

export interface LabAggregate {
  runsStarted: number
  runsCompleted: number
  restarts: number
  voluntaryReplays: number
  forkWide: number
  forkTight: number
  scores: number[]
}

const KEY = 'nim-relay:lab:relay-run-v2:agg'

export function loadAggregate(): LabAggregate {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as LabAggregate
  } catch {
    /* private mode — start fresh */
  }
  return { runsStarted: 0, runsCompleted: 0, restarts: 0, voluntaryReplays: 0, forkWide: 0, forkTight: 0, scores: [] }
}

export function saveAggregate(a: LabAggregate): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...a, scores: a.scores.slice(-200) }))
  } catch {
    /* ignore */
  }
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]!
}

export class RunInstruments {
  private frameTimes: number[] = []
  private latencies: number[] = []
  private pendingInputAt: number | null = null
  private startedAt = performance.now()
  maxDrawCalls = 0
  ghostLeadChanges = 0
  private lastLeadSign = 0

  markInputReceived(): void {
    this.pendingInputAt ??= performance.now()
  }

  markInputApplied(): void {
    if (this.pendingInputAt !== null) {
      this.latencies.push(performance.now() - this.pendingInputAt)
      this.pendingInputAt = null
    }
  }

  frame(elapsedMs: number, drawCalls: number): void {
    if (elapsedMs > 0 && elapsedMs < 500) this.frameTimes.push(elapsedMs)
    if (drawCalls > this.maxDrawCalls) this.maxDrawCalls = drawCalls
  }

  ghostDelta(delta: number): void {
    const sign = delta > 0 ? 1 : delta < 0 ? -1 : 0
    if (sign !== 0 && this.lastLeadSign !== 0 && sign !== this.lastLeadSign) this.ghostLeadChanges++
    if (sign !== 0) this.lastLeadSign = sign
  }

  report(fields: {
    completed: boolean
    score: number
    ticks: number
    forkChoice: RunReport['forkChoice']
    redline: RunReport['redline']
    ghostResult: RunReport['ghostResult']
    worstModule: string
  }): RunReport {
    const sortedFrames = [...this.frameTimes].sort((a, b) => a - b)
    const sortedLat = [...this.latencies].sort((a, b) => a - b)
    const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0)
    const round2 = (n: number): number => Math.round(n * 100) / 100
    return {
      ...fields,
      durationMs: Math.round(performance.now() - this.startedAt),
      frameMs: {
        mean: round2(mean(sortedFrames)),
        p50: round2(percentile(sortedFrames, 50)),
        p95: round2(percentile(sortedFrames, 95)),
        p99: round2(percentile(sortedFrames, 99)),
        worst: round2(sortedFrames.at(-1) ?? 0),
        frames: sortedFrames.length,
      },
      maxDrawCalls: this.maxDrawCalls,
      inputLatencyMs: {
        mean: round2(mean(sortedLat)),
        p95: round2(percentile(sortedLat, 95)),
        samples: sortedLat.length,
      },
      ghostLeadChanges: this.ghostLeadChanges,
    }
  }
}
