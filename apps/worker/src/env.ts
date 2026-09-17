import type { StationRoom } from './station/room'
import type { RelayRoom } from './durable/relay-room'

export interface Env {
  STATION_ROOM: DurableObjectNamespace<StationRoom>
  ASSETS: Fetcher
  RELAY_ROOM: DurableObjectNamespace<RelayRoom>
  /** Bound from Phase 4+ when replay-artifact storage is built; unbound today. */
  REPLAY_BUCKET?: R2Bucket

  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  SESSION_SECRET: string
  DEVICE_HASH_SECRET: string
  RUN_CHALLENGE_SECRET: string
  NIMIQ_NETWORK: 'TestAlbatross' | 'MainAlbatross'
  NIMIQ_RPC_URL: string
  APP_ORIGIN: string
  /** Comma-separated player ids or handles allowed to read the operator report. Unset or empty allows nobody. */
  OPS_PLAYERS?: string

  /**
   * Relay Grants treasury (docs/grants.md). Unset or anything but "true" keeps grants off. The key is a Worker secret
   * only: hex Ed25519 private key of a dedicated low-balance wallet. Caps and amounts are NIM decimal strings that
   * override the defaults in station/network/grants/config.ts and can only lower the hard ceilings there.
   */
  TREASURY_ENABLED?: string
  TREASURY_PRIVATE_KEY?: string
  TREASURY_TX_CAP_NIM?: string
  TREASURY_PARTICIPANT_CAP_NIM?: string
  TREASURY_DAILY_CAP_NIM?: string
  TREASURY_GLOBAL_CAP_NIM?: string
  TREASURY_LOW_BALANCE_NIM?: string
  /** e.g. "starter:1,first_handoff:1". Milestones not listed keep their default amount. */
  GRANT_AMOUNTS_NIM?: string
  /** Fee per grant transfer in Luna. Albatross accepts zero-fee basic transfers. */
  GRANT_FEE_LUNA?: string
}
