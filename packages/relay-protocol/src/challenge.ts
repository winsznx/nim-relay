import type { ChallengeId } from '@nim-relay/game-engine'

/**
 * PRD section 7.8 - server-issued challenge. The Worker issues a challenge
 * config the client cannot alter and still submit a valid run: every field
 * below is covered by an HMAC (`mac`) the Worker computes with
 * `RUN_CHALLENGE_SECRET`. The client plays locally, then submits the input
 * trace with the issued config; the Worker re-checks the MAC, replays the
 * trace with the same engine, and derives the canonical score (PRD 7.7).
 *
 * This module is pure: it defines the field set and the exact bytes the MAC
 * is taken over. The HMAC itself is done in the Worker (`crypto.subtle`),
 * mirroring the session-token code.
 */

export interface ChallengeFields {
  runId: string
  engineVersion: string
  challenge: ChallengeId
  challengeVersion: string
  seed: string
  difficulty: number
  durationMs: number
  rulesHash: string
  /** Epoch ms after which a not-yet-started run is refused. */
  startBefore: number
}

export interface IssuedChallenge extends ChallengeFields {
  mac: string
}

const FIELD_ORDER: readonly (keyof ChallengeFields)[] = [
  'runId',
  'engineVersion',
  'challenge',
  'challengeVersion',
  'seed',
  'difficulty',
  'durationMs',
  'rulesHash',
  'startBefore',
]

/** The exact ASCII string the challenge MAC is computed over. Fixed field
 * order, `\n`-joined `key=value`; values are primitives with stable
 * `String()` forms, so this needs no JSON canonicalization. */
export function challengeMacMessage(fields: ChallengeFields): string {
  return FIELD_ORDER.map((key) => `${key}=${String(fields[key])}`).join('\n')
}

export function isChallengeStartable(fields: ChallengeFields, now: number): boolean {
  return Number.isFinite(fields.startBefore) && now <= fields.startBefore
}

const SEED_PATTERN = /^[0-9a-f]{16,64}$/
const RESULT_HASH_PATTERN = /^[0-9a-f]{64}$/

/** Structural check on issued-challenge fields before any MAC work. */
export function isWellFormedChallenge(value: unknown): value is IssuedChallenge {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.runId === 'string' &&
    c.engineVersion === '1.0.0' &&
    typeof c.challenge === 'string' &&
    c.challengeVersion === '1.0.0' &&
    typeof c.seed === 'string' &&
    SEED_PATTERN.test(c.seed) &&
    Number.isInteger(c.difficulty) &&
    (c.difficulty as number) >= 1 &&
    (c.difficulty as number) <= 10 &&
    Number.isInteger(c.durationMs) &&
    (c.durationMs as number) >= 15000 &&
    (c.durationMs as number) <= 30000 &&
    typeof c.rulesHash === 'string' &&
    RESULT_HASH_PATTERN.test(c.rulesHash) &&
    Number.isInteger(c.startBefore) &&
    typeof c.mac === 'string' &&
    RESULT_HASH_PATTERN.test(c.mac)
  )
}
