import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { InputTrace } from '@nim-relay/game-engine'
import type { Env } from '../env'

/**
 * Persistence port for server-verified game runs (`game_runs`, PRD 7.9).
 * Supabase-backed when `SUPABASE_SERVICE_ROLE_KEY` is set, in-memory
 * otherwise - same pattern as the auth store.
 */

export interface GameRunRecord {
  id: string
  playerId: string
  challenge: string
  seed: string
  difficulty: number
  engineVersion: string
  challengeVersion: string
  rulesHash: string
  score: number
  success: boolean
  serverResultHash: string
  clientResultHash: string | null
  artifactSha256: string
  verificationVersion: string
  verifiedAt: string
}

export interface NewGameRun {
  id: string
  playerId: string
  challenge: string
  seed: string
  difficulty: number
  engineVersion: string
  challengeVersion: string
  rulesHash: string
  score: number
  success: boolean
  serverResultHash: string
  clientResultHash: string | null
  artifactSha256: string
  inputTrace: InputTrace
  verificationVersion: string
}

export interface RunStore {
  getRun(runId: string): Promise<GameRunRecord | null>
  /** Idempotent on `id`: a repeated submit returns the stored run with `created: false`. */
  insertRun(run: NewGameRun): Promise<{ record: GameRunRecord; created: boolean }>
}

const UNIQUE_VIOLATION = '23505'

interface RunRow {
  id: string
  player_id: string
  challenge_type: string
  seed: string
  difficulty: number
  engine_version: string
  challenge_version: string
  rules_hash: string
  score: number
  success: boolean
  server_result_hash: string
  client_result_hash: string | null
  artifact_sha256: string
  verification_version: string
  verified_at: string
}

function toRecord(row: RunRow): GameRunRecord {
  return {
    id: row.id,
    playerId: row.player_id,
    challenge: row.challenge_type,
    seed: row.seed,
    difficulty: row.difficulty,
    engineVersion: row.engine_version,
    challengeVersion: row.challenge_version,
    rulesHash: row.rules_hash,
    score: Number(row.score),
    success: row.success,
    serverResultHash: row.server_result_hash,
    clientResultHash: row.client_result_hash,
    artifactSha256: row.artifact_sha256,
    verificationVersion: row.verification_version,
    verifiedAt: row.verified_at,
  }
}

function rowFor(run: NewGameRun) {
  return {
    id: run.id,
    player_id: run.playerId,
    challenge_type: run.challenge,
    challenge_version: run.challengeVersion,
    engine_version: run.engineVersion,
    seed: run.seed,
    difficulty: run.difficulty,
    rules_hash: run.rulesHash,
    score: run.score,
    success: run.success,
    server_result_hash: run.serverResultHash,
    client_result_hash: run.clientResultHash,
    artifact_sha256: run.artifactSha256,
    input_trace: run.inputTrace,
    verification_version: run.verificationVersion,
  }
}

const SELECT =
  'id, player_id, challenge_type, seed, difficulty, engine_version, challenge_version, rules_hash, score, success, server_result_hash, client_result_hash, artifact_sha256, verification_version, verified_at'

export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, GameRunRecord>()

  async getRun(runId: string): Promise<GameRunRecord | null> {
    return this.runs.get(runId) ?? null
  }

  async insertRun(run: NewGameRun): Promise<{ record: GameRunRecord; created: boolean }> {
    const existing = this.runs.get(run.id)
    if (existing) return { record: existing, created: false }
    const record: GameRunRecord = {
      id: run.id,
      playerId: run.playerId,
      challenge: run.challenge,
      seed: run.seed,
      difficulty: run.difficulty,
      engineVersion: run.engineVersion,
      challengeVersion: run.challengeVersion,
      rulesHash: run.rulesHash,
      score: run.score,
      success: run.success,
      serverResultHash: run.serverResultHash,
      clientResultHash: run.clientResultHash,
      artifactSha256: run.artifactSha256,
      verificationVersion: run.verificationVersion,
      verifiedAt: new Date().toISOString(),
    }
    this.runs.set(run.id, record)
    return { record, created: true }
  }
}

export class SupabaseRunStore implements RunStore {
  constructor(private readonly db: SupabaseClient) {}

  static fromEnv(url: string, serviceRoleKey: string): SupabaseRunStore {
    return new SupabaseRunStore(
      createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    )
  }

  async getRun(runId: string): Promise<GameRunRecord | null> {
    const { data, error } = await this.db.from('game_runs').select(SELECT).eq('id', runId).maybeSingle()
    if (error) throw new Error(`getRun: ${error.message}`)
    return data ? toRecord(data as RunRow) : null
  }

  async insertRun(run: NewGameRun): Promise<{ record: GameRunRecord; created: boolean }> {
    const { data, error } = await this.db.from('game_runs').insert(rowFor(run)).select(SELECT).single()
    if (!error) return { record: toRecord(data as RunRow), created: true }
    if (error.code !== UNIQUE_VIOLATION) throw new Error(`insertRun: ${error.message}`)
    const existing = await this.getRun(run.id)
    if (!existing) throw new Error('insertRun: conflict but no existing row')
    return { record: existing, created: false }
  }
}

let inMemorySingleton: InMemoryRunStore | null = null
let supabaseSingleton: RunStore | null = null

export function getRunStore(env: Pick<Env, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'> | undefined): RunStore {
  const url = env?.SUPABASE_URL
  const key = env?.SUPABASE_SERVICE_ROLE_KEY
  if (url && key) {
    supabaseSingleton ??= SupabaseRunStore.fromEnv(url, key)
    return supabaseSingleton
  }
  inMemorySingleton ??= new InMemoryRunStore()
  return inMemorySingleton
}

export function __resetRunStoreForTests(): void {
  inMemorySingleton = null
  supabaseSingleton = null
}
