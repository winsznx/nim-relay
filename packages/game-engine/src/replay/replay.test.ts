import { describe, expect, it } from 'vitest'
import { createState, step, totalTicks, CHALLENGE_IDS, type RunConfig } from '../simulation'
import { scoreState } from '../scoring'
import { replay, ReplayError, resultForState } from './index'
import { canonicalJSON, sha256 } from './hash'

const config: RunConfig = { engineVersion: '1.0.0', challengeVersion: '1.0.0', challenge: 'stabilize', seed: 'test', difficulty: 3, durationMs: 20000 }
describe('version-bound pure replay', () => {
  it('matches SHA-256 standard vectors, including multi-block input', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
    expect(canonicalJSON({ seed: '🚀' })).toBe('{"seed":"\\ud83d\\ude80"}')
  })
  it('does not mutate config, state, metrics, or input trace', () => {
    const frozenConfig = Object.freeze({ ...config })
    const state = createState(frozenConfig)
    Object.freeze(state.metrics); Object.freeze(state)
    const before = JSON.stringify(state)
    expect(step(state, 1, 0)).not.toBe(state)
    expect(JSON.stringify(state)).toBe(before)
    const trace = Object.freeze([Object.freeze([0, 1] as const)])
    expect(() => replay({ ...config, inputTrace: trace })).not.toThrow()
  })
  it('binds seed, challenge, difficulty, duration, rules and input trace to the hash', () => {
    const base = replay({ ...config, inputTrace: [] })
    const variants = [ { seed: 'other' }, { difficulty: 4 }, { durationMs: 20001 }, { challenge: 'sling' as const }, { inputTrace: [[0, 1] as const] } ]
    for (const change of variants) expect(replay({ ...config, inputTrace: [], ...change }).resultHash).not.toBe(base.resultHash)
    expect(base.rulesHash).toMatch(/^[a-f0-9]{64}$/)
    expect(replay({ ...config, seed: '🚀', inputTrace: [] }).resultHash).toMatch(/^[a-f0-9]{64}$/)
  })
  it('rejects unsupported versions and malformed replay traces', () => {
    expect(() => replay({ ...config, engineVersion: '0.1.0', inputTrace: [] })).toThrow(RangeError)
    expect(() => replay({ ...config, challengeVersion: '2.0.0', inputTrace: [] })).toThrow(RangeError)
    expect(() => replay({ ...config, inputTrace: [[20000, 1]] })).toThrow(ReplayError)
    for (const change of [{ seed: '' }, { difficulty: 0 }, { difficulty: 11 }, { difficulty: 1.5 }, { durationMs: 30001 }]) expect(() => createState({ ...config, ...change })).toThrow(RangeError)
  })
  it('steps at exactly 60Hz and stops at the bounded duration', () => {
    expect(totalTicks({ durationMs: 20000 })).toBe(1200)
    expect(totalTicks({ durationMs: 15001 })).toBe(901)
    let state = createState({ ...config, durationMs: 15000 })
    expect(() => step(state, 1, 1)).toThrow(RangeError)
    for (let tick = 0; tick < 900; tick++) state = step(state, 0, tick)
    expect(step(state, 1, 900)).toBe(state)
  })
  it('detects one-unit final-state drift even when displayed scores round identically', () => {
    let state = createState({ ...config, durationMs: 15000 })
    for (let tick = 0; tick < 900; tick++) state = step(state, 0, tick)
    const altered = { ...state, position: state.position + 1 }
    expect(scoreState(altered)).toEqual(scoreState(state))
    expect(resultForState(altered, []).resultHash).not.toBe(resultForState(state, []).resultHash)
  })
  it('bounds Sling to one scored release per signal cycle', () => {
    let state = createState({ ...config, challenge: 'sling' })
    for (let tick = 0; tick < 60; tick++) state = step(state, tick % 2 === 0 ? 1 : 0, tick)
    expect(state.metrics.attempts).toBe(1)
  })
  it('makes every documented score input observable in its structured breakdown', () => {
    const inputs = {
      stabilize: ['safeTicks', 'perfectTicks', 'controlError', 'boundaryStrikes', 'recoveryTicks'],
      slipstream: ['gateHits', 'centerAccuracy', 'misses', 'completionTicks', 'pathDeviation'],
      'pulse-sync': ['timingError', 'perfectSyncs', 'maxCombo', 'missedPulses'],
      sling: ['angleError', 'powerError', 'timingAccuracy', 'maxStreak', 'maxCombo'],
      redline: ['recoveryTicks', 'stabilityGain', 'boundaryStrikes', 'finalStability'],
    } as const
    for (const challenge of CHALLENGE_IDS) {
      const state = { ...createState({ ...config, challenge }), tick: 600 }
      const baseline = scoreState(state)
      for (const metric of inputs[challenge]) {
        const changed = { ...state, metrics: { ...state.metrics, [metric]: state.metrics[metric] + 65536 } }
        expect(scoreState(changed).breakdown).not.toEqual(baseline.breakdown)
      }
    }
  })
})
