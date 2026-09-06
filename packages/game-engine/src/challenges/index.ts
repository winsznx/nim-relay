import { createState, deriveConfig, step } from '../simulation'
import type { ChallengeId, RunConfig } from '../simulation'

function versionOne(id: ChallengeId) {
  return Object.freeze({
    id,
    version: '1.0.0' as const,
    deriveConfig,
    initialState(config: RunConfig) {
      if (config.challenge !== id) throw new RangeError('Challenge handler does not match run config')
      return createState(config)
    },
    step,
  })
}

// These handlers and their corpus are immutable once released. Add a new entry
// and retain v1's implementation when introducing another challenge version.
export const CHALLENGE_VERSIONS = Object.freeze({
  stabilize: Object.freeze({ '1.0.0': versionOne('stabilize') }),
  slipstream: Object.freeze({ '1.0.0': versionOne('slipstream') }),
  'pulse-sync': Object.freeze({ '1.0.0': versionOne('pulse-sync') }),
  sling: Object.freeze({ '1.0.0': versionOne('sling') }),
  redline: Object.freeze({ '1.0.0': versionOne('redline') }),
})

export const RULES = Object.freeze({
  engineVersion: '1.0.0',
  challengeVersion: '1.0.0',
  ticksPerSecond: 60,
  fixedPoint: 'Q16.16/truncate-toward-zero',
  traceMapping: 'tMs*60<=tick*1000',
  durationMin: 15000,
  durationMax: 30000,
  scoringVersion: '1.0.0',
  physicsVersion: '1.0.0',
})
