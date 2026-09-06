import { describe, expect, it } from 'vitest'
import { challengeMacMessage, isChallengeStartable, isWellFormedChallenge, type ChallengeFields } from './challenge'

const fields: ChallengeFields = {
  runId: '11111111-1111-4111-8111-111111111111',
  engineVersion: '1.0.0',
  challenge: 'stabilize',
  challengeVersion: '1.0.0',
  seed: 'a1b2c3d4e5f60718',
  difficulty: 3,
  durationMs: 20000,
  rulesHash: 'f'.repeat(64),
  startBefore: 1_800_000_000_000,
}

describe('challengeMacMessage', () => {
  it('is a stable, fixed-order key=value string', () => {
    expect(challengeMacMessage(fields)).toBe(
      [
        'runId=11111111-1111-4111-8111-111111111111',
        'engineVersion=1.0.0',
        'challenge=stabilize',
        'challengeVersion=1.0.0',
        'seed=a1b2c3d4e5f60718',
        'difficulty=3',
        'durationMs=20000',
        `rulesHash=${'f'.repeat(64)}`,
        'startBefore=1800000000000',
      ].join('\n'),
    )
  })

  it('changes when any covered field changes', () => {
    const base = challengeMacMessage(fields)
    for (const [key, value] of Object.entries({ seed: 'deadbeefdeadbeef', difficulty: 4, durationMs: 25000, startBefore: 1 })) {
      expect(challengeMacMessage({ ...fields, [key]: value })).not.toBe(base)
    }
  })
})

describe('isChallengeStartable', () => {
  it('is true up to and including startBefore, false after', () => {
    expect(isChallengeStartable(fields, fields.startBefore - 1)).toBe(true)
    expect(isChallengeStartable(fields, fields.startBefore)).toBe(true)
    expect(isChallengeStartable(fields, fields.startBefore + 1)).toBe(false)
  })
})

describe('isWellFormedChallenge', () => {
  const issued = { ...fields, mac: '0'.repeat(64) }

  it('accepts a well-formed issued challenge', () => {
    expect(isWellFormedChallenge(issued)).toBe(true)
  })

  it('rejects bad shapes without throwing', () => {
    expect(isWellFormedChallenge(null)).toBe(false)
    expect(isWellFormedChallenge({ ...issued, engineVersion: '2.0.0' })).toBe(false)
    expect(isWellFormedChallenge({ ...issued, difficulty: 0 })).toBe(false)
    expect(isWellFormedChallenge({ ...issued, difficulty: 11 })).toBe(false)
    expect(isWellFormedChallenge({ ...issued, durationMs: 10000 })).toBe(false)
    expect(isWellFormedChallenge({ ...issued, seed: 'xyz' })).toBe(false)
    expect(isWellFormedChallenge({ ...issued, rulesHash: 'short' })).toBe(false)
    expect(isWellFormedChallenge({ ...issued, mac: 'short' })).toBe(false)
    expect(isWellFormedChallenge({ ...issued, mac: undefined })).toBe(false)
  })
})
