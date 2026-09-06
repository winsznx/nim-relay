import { Hono } from 'hono'
import { z } from 'zod'
import {
  CHALLENGE_IDS,
  ENGINE_VERSION,
  replay,
  ReplayError,
  RULES_HASH,
} from '@nim-relay/game-engine'
import { isWellFormedChallenge, type ChallengeFields } from '@nim-relay/relay-protocol'
import type { Env } from '../env'
import { requireSession, type AuthedVars } from '../auth/middleware'
import { signChallenge, verifyChallenge } from './challenge-mac'
import { getRunStore } from './store'

/**
 * PRD sections 7.7-7.9 - server-issued challenges and server-verified runs.
 *
 *   POST /api/runs/issue    -> IssuedChallenge   (signed config the client cannot alter)
 *   POST /api/runs/submit   -> canonical result  (Worker replays the trace, never trusts clientScore)
 *   GET  /api/runs/:runId   -> stored run        (owner only)
 *
 * The server-derived result is the only one that may affect qualification,
 * ghosts, leaderboards or XP (PRD 7.7).
 */

const VERIFICATION_VERSION = '1.0.0'
const CHALLENGE_VERSION = '1.0.0'
const SOLO_DIFFICULTY = 3
const SOLO_DURATION_MS = 20_000
const START_WINDOW_MS = 5 * 60 * 1000

const challengeId = z.enum(CHALLENGE_IDS)
const issueBody = z.object({ challenge: challengeId })
const submitBody = z.object({
  runId: z.string(),
  engineVersion: z.string(),
  challenge: challengeId,
  challengeVersion: z.string(),
  seed: z.string(),
  difficulty: z.number(),
  durationMs: z.number(),
  rulesHash: z.string(),
  startBefore: z.number(),
  mac: z.string(),
  inputTrace: z.array(z.tuple([z.number(), z.union([z.literal(0), z.literal(1)])])),
  clientResultHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
})

function randomSeed(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const runRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>()

runRoutes.use('*', requireSession)

runRoutes.post('/issue', async (c) => {
  const parsed = issueBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400)

  const fields: ChallengeFields = {
    runId: crypto.randomUUID(),
    engineVersion: ENGINE_VERSION,
    challenge: parsed.data.challenge,
    challengeVersion: CHALLENGE_VERSION,
    seed: randomSeed(),
    difficulty: SOLO_DIFFICULTY,
    durationMs: SOLO_DURATION_MS,
    rulesHash: RULES_HASH,
    startBefore: Date.now() + START_WINDOW_MS,
  }
  return c.json(await signChallenge(c.env, fields))
})

runRoutes.post('/submit', async (c) => {
  const parsed = submitBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400)
  const { inputTrace, clientResultHash, ...issued } = parsed.data

  if (!isWellFormedChallenge(issued)) return c.json({ error: 'bad_challenge' }, 400)
  const fields = await verifyChallenge(c.env, issued)
  if (!fields) return c.json({ error: 'bad_mac' }, 401)
  if (fields.rulesHash !== RULES_HASH) return c.json({ error: 'stale_rules' }, 409)
  if (Date.now() > fields.startBefore + fields.durationMs) return c.json({ error: 'expired' }, 410)

  let result: ReturnType<typeof replay>
  try {
    result = replay({
      engineVersion: fields.engineVersion,
      challenge: fields.challenge,
      challengeVersion: fields.challengeVersion,
      seed: fields.seed,
      difficulty: fields.difficulty,
      durationMs: fields.durationMs,
      inputTrace,
    })
  } catch (err) {
    if (err instanceof ReplayError) return c.json({ error: 'invalid_trace', code: err.code, index: err.index }, 400)
    throw err
  }

  const artifactSha256 = await sha256Hex(JSON.stringify(inputTrace))
  const { record, created } = await getRunStore(c.env).insertRun({
    id: fields.runId,
    playerId: c.get('playerId'),
    challenge: fields.challenge,
    seed: fields.seed,
    difficulty: fields.difficulty,
    engineVersion: fields.engineVersion,
    challengeVersion: fields.challengeVersion,
    rulesHash: fields.rulesHash,
    score: result.score,
    success: result.score > 0,
    serverResultHash: result.resultHash,
    clientResultHash: clientResultHash ?? null,
    artifactSha256,
    inputTrace,
    verificationVersion: VERIFICATION_VERSION,
  })

  return c.json({
    runId: record.id,
    challenge: record.challenge,
    score: record.score,
    success: record.success,
    breakdown: result.breakdown,
    serverResultHash: record.serverResultHash,
    clientMatchesServer: clientResultHash ? clientResultHash === result.resultHash : null,
    created,
  })
})

runRoutes.get('/:runId', async (c) => {
  const record = await getRunStore(c.env).getRun(c.req.param('runId'))
  if (!record || record.playerId !== c.get('playerId')) return c.json({ error: 'not_found' }, 404)
  return c.json({
    runId: record.id,
    challenge: record.challenge,
    score: record.score,
    success: record.success,
    serverResultHash: record.serverResultHash,
    verifiedAt: record.verifiedAt,
  })
})
