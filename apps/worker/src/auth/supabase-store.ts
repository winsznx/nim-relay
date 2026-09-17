import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { LoginNonce } from './nonce'
import type {
  AuthStore,
  CreatePlayerInput,
  CreateSessionInput,
  PlayerRecord,
  SessionRecord,
} from './store'

/**
 * Supabase-backed `AuthStore` (PRD sections 11.4-11.6, ARCHITECTURE.md
 * "four authorities" - players / sessions / login_nonces are durable
 * relational history).
 *
 * Uses the `service_role` key: every `public` table has RLS enabled with no
 * policies (Supabase auto-enables RLS on new tables; explicit policy design
 * is a Phase 9 security item), so only the service role can read or write.
 * The key is a Worker secret, never sent to the browser.
 */

const UNIQUE_VIOLATION = '23505'

interface PlayerRow {
  id: string
  handle: string
  display_name: string
  wallet_address: string
  wallet_public_key: string | null
}

interface SessionRow {
  id: string
  player_id: string
  expires_at: string
  revoked_at: string | null
  /** Embedded through sessions.device_id; PostgREST types it as a list, the relation yields at most one. */
  devices?: { device_hash: string } | { device_hash: string }[] | null
}

function toPlayer(row: PlayerRow): PlayerRecord {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    walletAddress: row.wallet_address,
    walletPublicKey: row.wallet_public_key ?? '',
  }
}

function toSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    playerId: row.player_id,
    expiresAt: Date.parse(row.expires_at),
    revokedAt: row.revoked_at ? Date.parse(row.revoked_at) : null,
    deviceHash: (Array.isArray(row.devices) ? row.devices[0] : row.devices)?.device_hash ?? null,
  }
}

const SESSION_COLUMNS = 'id, player_id, expires_at, revoked_at, devices(device_hash)'

function normalizeWallet(walletAddress: string): string {
  return walletAddress.replace(/\s+/g, '').toUpperCase()
}

function handleFromWallet(walletAddress: string, suffix?: number): string {
  const base = `runner-${normalizeWallet(walletAddress).slice(-6).toLowerCase()}`
  return suffix ? `${base}-${suffix}` : base
}

export class SupabaseAuthStore implements AuthStore {
  constructor(private readonly db: SupabaseClient) {}

  static fromEnv(url: string, serviceRoleKey: string): SupabaseAuthStore {
    return new SupabaseAuthStore(
      createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    )
  }

  async putNonce(nonce: LoginNonce): Promise<void> {
    const { error } = await this.db.from('login_nonces').insert({
      nonce: nonce.nonce,
      issued_at: new Date(nonce.issuedAt).toISOString(),
      expires_at: new Date(nonce.expiresAt).toISOString(),
    })
    if (error) throw new Error(`putNonce: ${error.message}`)
  }

  async consumeNonce(nonce: string): Promise<LoginNonce | null> {
    const { data, error } = await this.db
      .from('login_nonces')
      .delete()
      .eq('nonce', nonce)
      .select('nonce, issued_at, expires_at')
      .maybeSingle()
    if (error) throw new Error(`consumeNonce: ${error.message}`)
    if (!data) return null
    return {
      nonce: data.nonce,
      issuedAt: Date.parse(data.issued_at),
      expiresAt: Date.parse(data.expires_at),
    }
  }

  async findPlayerByWallet(walletAddress: string): Promise<PlayerRecord | null> {
    const { data, error } = await this.db
      .from('players')
      .select('id, handle, display_name, wallet_address, wallet_public_key')
      .eq('wallet_address', normalizeWallet(walletAddress))
      .maybeSingle()
    if (error) throw new Error(`findPlayerByWallet: ${error.message}`)
    return data ? toPlayer(data as PlayerRow) : null
  }

  async getPlayerById(playerId: string): Promise<PlayerRecord | null> {
    const { data, error } = await this.db
      .from('players')
      .select('id, handle, display_name, wallet_address, wallet_public_key')
      .eq('id', playerId)
      .maybeSingle()
    if (error) throw new Error(`getPlayerById: ${error.message}`)
    return data ? toPlayer(data as PlayerRow) : null
  }

  async createPlayer(input: CreatePlayerInput): Promise<PlayerRecord> {
    const wallet = normalizeWallet(input.walletAddress)
    for (let attempt = 0; attempt < 5; attempt++) {
      const handle = handleFromWallet(wallet, attempt)
      const { data, error } = await this.db
        .from('players')
        .insert({
          handle,
          display_name: handle,
          wallet_address: wallet,
          wallet_public_key: input.walletPublicKey,
        })
        .select('id, handle, display_name, wallet_address, wallet_public_key')
        .single()

      if (!error) return toPlayer(data as PlayerRow)
      if (error.code !== UNIQUE_VIOLATION) throw new Error(`createPlayer: ${error.message}`)

      const existing = await this.findPlayerByWallet(wallet)
      if (existing) return existing
      // else: handle collision on a different wallet - loop with a new suffix
    }
    throw new Error('createPlayer: exhausted handle attempts')
  }

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const deviceId = input.deviceHash ? await this.upsertDevice(input.playerId, input.deviceHash) : null
    const { data, error } = await this.db
      .from('sessions')
      .insert({
        player_id: input.playerId,
        device_id: deviceId,
        expires_at: new Date(input.expiresAt).toISOString(),
      })
      .select('id, player_id, expires_at, revoked_at')
      .single()
    if (error) throw new Error(`createSession: ${error.message}`)
    return { ...toSession(data as SessionRow), deviceHash: input.deviceHash }
  }

  async attachDevice(sessionId: string, playerId: string, deviceHash: string): Promise<SessionRecord | null> {
    const deviceId = await this.upsertDevice(playerId, deviceHash)
    const { error } = await this.db.from('sessions').update({ device_id: deviceId }).eq('id', sessionId).eq('player_id', playerId).is('device_id', null)
    if (error) throw new Error(`attachDevice: ${error.message}`)
    const session = await this.getSession(sessionId)
    return session?.playerId === playerId ? session : null
  }

  private async upsertDevice(playerId: string, deviceHash: string): Promise<string> {
    const { data, error } = await this.db
      .from('devices')
      .upsert({ player_id: playerId, device_hash: deviceHash, last_seen_at: new Date().toISOString() }, { onConflict: 'device_hash,player_id' })
      .select('id')
      .single()
    if (error) throw new Error(`upsertDevice: ${error.message}`)
    return (data as { id: string }).id
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const { data, error } = await this.db
      .from('sessions')
      .select(SESSION_COLUMNS)
      .eq('id', sessionId)
      .maybeSingle()
    if (error) throw new Error(`getSession: ${error.message}`)
    return data ? toSession(data as SessionRow) : null
  }

  async revokeSession(sessionId: string): Promise<void> {
    const { error } = await this.db
      .from('sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', sessionId)
      .is('revoked_at', null)
    if (error) throw new Error(`revokeSession: ${error.message}`)
  }

  async touchSession(sessionId: string): Promise<void> {
    const { error } = await this.db
      .from('sessions')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', sessionId)
    if (error) throw new Error(`touchSession: ${error.message}`)
  }
}
