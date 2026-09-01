import type { RelayRoom } from './durable/relay-room'

export interface Env {
  ASSETS: Fetcher
  RELAY_ROOM: DurableObjectNamespace<RelayRoom>
  REPLAY_BUCKET: R2Bucket

  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  SESSION_SECRET: string
  DEVICE_HASH_SECRET: string
  RUN_CHALLENGE_SECRET: string
  NIMIQ_NETWORK: 'TestAlbatross' | 'MainAlbatross'
  NIMIQ_RPC_URL: string
}
