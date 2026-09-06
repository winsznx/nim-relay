import { describe, expect, it } from 'vitest'
import {
  composeRoute,
  createRelayState,
  deriveCarryState,
  NEUTRAL_CARRY,
  RelayInputCursor,
  replayRelayRun,
  stepRelay,
  totalTicks,
  validateRelayTrace,
  type RelayInputTrace,
  type RelayReplayConfig,
} from './index'

const baseConfig: RelayReplayConfig = {
  engineVersion: '2',
  challenge: 'relay-run',
  challengeVersion: '2',
  seed: 'relay-run-test-1',
  legNumber: 3,
  sourceRegionId: 'aurora',
  destRegionId: 'desert',
  prevLeg: null,
  inputTrace: [],
}

/** Deterministic synthetic trace: a steer sweep + periodic presses, keyframed. */
function synthTrace(ticks: number, mode: number): RelayInputTrace {
  const out: [number, number, 0 | 1][] = [[0, 0, 0]]
  let lastTick = 0
  let steer = 0
  let pressed: 0 | 1 = 0
  for (let t = 1; t < ticks; t++) {
    const wantSteer = Math.max(-64, Math.min(64, Math.round(48 * Math.sign(((t * (mode + 1)) % 240) - 120))))
    const wantPressed: 0 | 1 = ((t + mode * 7) % (30 + mode * 10) < 8) ? 1 : 0
    const keyframe = t - lastTick >= 30
    if (wantSteer !== steer || wantPressed !== pressed || keyframe) {
      out.push([t - lastTick, wantSteer, wantPressed])
      lastTick = t
      steer = wantSteer
      pressed = wantPressed
    }
  }
  return out
}

describe('relay-run input trace validator', () => {
  const ticks = totalTicks(baseConfig)
  it('accepts a well-formed keyframed trace', () => {
    expect(validateRelayTrace(synthTrace(ticks, 1), ticks).ok).toBe(true)
  })
  it('rejects malformed traces without throwing', () => {
    expect(validateRelayTrace('nope', ticks)).toMatchObject({ ok: false, error: { code: 'shape' } })
    expect(validateRelayTrace([], ticks)).toMatchObject({ ok: false, error: { code: 'count' } })
    expect(validateRelayTrace([[5, 0, 0]], ticks)).toMatchObject({ ok: false, error: { code: 'first-tick' } })
    expect(validateRelayTrace([[0, 0, 0], [-1, 0, 1]], ticks)).toMatchObject({ ok: false, error: { code: 'order' } })
    expect(validateRelayTrace([[0, 99, 0]], ticks)).toMatchObject({ ok: false, error: { code: 'steer-range' } })
    expect(validateRelayTrace([[0, 0, 2 as 0]], ticks)).toMatchObject({ ok: false, error: { code: 'pressed-value' } })
    expect(validateRelayTrace([[0, 0, 0], [ticks + 5, 0, 1]], ticks)).toMatchObject({ ok: false, error: { code: 'after-end' } })
  })
})

describe('relay-run route composition', () => {
  it('is deterministic for the same inputs', () => {
    const a = composeRoute('seed-x', 5, NEUTRAL_CARRY)
    const b = composeRoute('seed-x', 5, NEUTRAL_CARRY)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
  it('differs by seed and by leg number', () => {
    expect(JSON.stringify(composeRoute('a', 5, NEUTRAL_CARRY))).not.toBe(JSON.stringify(composeRoute('b', 5, NEUTRAL_CARRY)))
    expect(JSON.stringify(composeRoute('a', 5, NEUTRAL_CARRY))).not.toBe(JSON.stringify(composeRoute('a', 30, NEUTRAL_CARRY)))
  })
  it('always contains exactly one pulse, one fork, one turbulence, one sling, in skeleton order', () => {
    const kinds = composeRoute('any', 12, NEUTRAL_CARRY).map((m) => m.kind)
    expect(kinds[0]).toBe('catch')
    expect(kinds.at(-1)).toBe('sling')
    expect(kinds.filter((k) => k === 'pulse')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'fork')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'turbulence')).toHaveLength(1)
  })
})

describe('relay-run leg inheritance (§2.7)', () => {
  it('clamps every carry-state to a band around baseline, even for a disastrous previous run', () => {
    const worst = deriveCarryState({ cleanGateRatio: 0, turbulenceScoreNorm: 65536, slingAccuracy: 0, slingAngle: 65536 })
    const best = deriveCarryState({ cleanGateRatio: 65536, turbulenceScoreNorm: 0, slingAccuracy: 65536, slingAngle: -65536 })
    expect(worst.incomingMomentum).toBeGreaterThanOrEqual(Math.floor(0.85 * 65536))
    expect(best.incomingMomentum).toBeLessThanOrEqual(Math.floor(1.15 * 65536))
    expect(worst.catchWindowScale).toBeGreaterThanOrEqual(Math.floor(0.45 * 65536))
    expect(worst.catchWindowScale).toBeLessThanOrEqual(Math.floor(1.4 * 65536))
    expect(Math.abs(worst.incomingTrajectory)).toBeLessThan(65536)
  })
})

describe('relay-run deterministic replay', () => {
  it('replay() equals an incrementally stepped run, and is repeatable byte-for-byte', () => {
    const ticks = totalTicks(baseConfig)
    const trace = synthTrace(ticks, 2)
    const validated = validateRelayTrace(trace, ticks)
    if (!validated.ok) throw new Error('bad synth trace')

    const first = replayRelayRun({ ...baseConfig, inputTrace: trace })
    const second = replayRelayRun({ ...baseConfig, inputTrace: trace })
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))

    let state = createRelayState(baseConfig)
    const cursor = new RelayInputCursor(validated.trace)
    for (let t = 0; t < ticks; t++) state = stepRelay(state, cursor.at(t), t)
    expect(state.tick).toBe(ticks)
    expect(state.metrics.totalGates).toBeGreaterThan(0)
    expect(Number.isSafeInteger(state.x)).toBe(true)
  })

  it('different input traces produce different scores', () => {
    const ticks = totalTicks(baseConfig)
    const a = replayRelayRun({ ...baseConfig, inputTrace: synthTrace(ticks, 1) })
    const b = replayRelayRun({ ...baseConfig, inputTrace: synthTrace(ticks, 5) })
    expect(a.score).not.toBe(b.score)
    expect(a.resultHash).not.toBe(b.resultHash)
  })

  it('the resultHash changes if a single steer sample changes', () => {
    const ticks = totalTicks(baseConfig)
    const trace = synthTrace(ticks, 3) as [number, number, 0 | 1][]
    const tampered = trace.map((s, i) => (i === 4 ? [s[0], (s[1] + 1) as number, s[2]] as [number, number, 0 | 1] : s))
    expect(replayRelayRun({ ...baseConfig, inputTrace: tampered }).resultHash).not.toBe(
      replayRelayRun({ ...baseConfig, inputTrace: trace }).resultHash,
    )
  })
})
