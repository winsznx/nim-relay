import type { LoginNonce } from './nonce'
import { SupabaseAuthStore } from './supabase-store'

/**
 * Persistence port for the auth flow. The Worker owns no money and no live
 * coordination state (see ARCHITECTURE.md "four authorities"); auth state -
 * players, sessions, issued login nonces - is durable relational history and
 * belongs in Supabase Postgres.
 *
 * The Supabase-backed implementation lands once the fresh project's
 * credentials are provided (DECISIONS.md D-003; tracked in run-state.json
 * `blockers`). Until then `InMemoryAuthStore` backs local `wrangler dev` and
 * the route tests. In-memory state is per-isolate and non-durable by design -
 * it is never the production store.
 */

export interface PlayerRecord {
  id: string
  handle: string
  displayName: string
  walletAddress: string
  walletPublicKey: string
}

export interface SessionRecord {
  id: string
  playerId: string
  expiresAt: number
  revokedAt: number | null
}

export interface CreatePlayerInput {
  walletAddress: string
  walletPublicKey: string
}

export interface CreateSessionInput {
  playerId: string
  deviceHash: string | null
  expiresAt: number
}

export interface AuthStore {
  putNonce(nonce: LoginNonce): Promise<void>
  /** Single-use: returns the nonce and removes it so it can never be replayed. */
  consumeNonce(nonce: string): Promise<LoginNonce | null>

  findPlayerByWallet(walletAddress: string): Promise<PlayerRecord | null>
  getPlayerById(playerId: string): Promise<PlayerRecord | null>
  createPlayer(input: CreatePlayerInput): Promise<PlayerRecord>

  createSession(input: CreateSessionInput): Promise<SessionRecord>
  getSession(sessionId: string): Promise<SessionRecord | null>
  revokeSession(sessionId: string): Promise<void>
  touchSession(sessionId: string): Promise<void>
}

function shortWalletHandle(walletAddress: string): string {
  const compact = walletAddress.replace(/\s+/g, '').toUpperCase()
  return `runner-${compact.slice(-6).toLowerCase()}`
}

export class InMemoryAuthStore implements AuthStore {
  private readonly nonces = new Map<string, LoginNonce>()
  private readonly players = new Map<string, PlayerRecord>()
  private readonly playersByWallet = new Map<string, string>()
  private readonly sessions = new Map<string, SessionRecord>()

  async putNonce(nonce: LoginNonce): Promise<void> {
    this.nonces.set(nonce.nonce, nonce)
  }

  async consumeNonce(nonce: string): Promise<LoginNonce | null> {
    const found = this.nonces.get(nonce) ?? null
    this.nonces.delete(nonce)
    return found
  }

  async findPlayerByWallet(walletAddress: string): Promise<PlayerRecord | null> {
    const key = walletAddress.replace(/\s+/g, '').toUpperCase()
    const id = this.playersByWallet.get(key)
    return id ? (this.players.get(id) ?? null) : null
  }

  async getPlayerById(playerId: string): Promise<PlayerRecord | null> {
    return this.players.get(playerId) ?? null
  }

  async createPlayer(input: CreatePlayerInput): Promise<PlayerRecord> {
    const key = input.walletAddress.replace(/\s+/g, '').toUpperCase()
    const existing = this.playersByWallet.get(key)
    if (existing) return this.players.get(existing)!

    let handle = shortWalletHandle(input.walletAddress)
    for (let n = 2; [...this.players.values()].some((p) => p.handle === handle); n++) {
      handle = `${shortWalletHandle(input.walletAddress)}-${n}`
    }
    const record: PlayerRecord = {
      id: crypto.randomUUID(),
      handle,
      displayName: handle,
      walletAddress: key,
      walletPublicKey: input.walletPublicKey,
    }
    this.players.set(record.id, record)
    this.playersByWallet.set(key, record.id)
    return record
  }

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const record: SessionRecord = {
      id: crypto.randomUUID(),
      playerId: input.playerId,
      expiresAt: input.expiresAt,
      revokedAt: null,
    }
    this.sessions.set(record.id, record)
    return record
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    return this.sessions.get(sessionId) ?? null
  }

  async revokeSession(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (s && s.revokedAt === null) s.revokedAt = Date.now()
  }

  async touchSession(): Promise<void> {
    // last_seen_at bookkeeping is a no-op in memory; the Supabase impl updates the row.
  }
}

interface AuthStoreEnv {
  SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
}

let inMemorySingleton: InMemoryAuthStore | null = null
let supabaseSingleton: AuthStore | null = null

/**
 * Resolve the auth store for a request. Uses the Supabase-backed store when a
 * `service_role` key is configured (production / linked dev), and the
 * in-memory store otherwise (local `wrangler dev` without secrets, and tests).
 * Route and middleware code depends only on the `AuthStore` interface.
 */
export function getAuthStore(env: AuthStoreEnv | undefined): AuthStore {
  const url = env?.SUPABASE_URL
  const key = env?.SUPABASE_SERVICE_ROLE_KEY
  if (url && key) {
    supabaseSingleton ??= SupabaseAuthStore.fromEnv(url, key)
    return supabaseSingleton
  }
  inMemorySingleton ??= new InMemoryAuthStore()
  return inMemorySingleton
}

export function __resetAuthStoreForTests(): void {
  inMemorySingleton = null
  supabaseSingleton = null
}
