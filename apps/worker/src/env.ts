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
}
