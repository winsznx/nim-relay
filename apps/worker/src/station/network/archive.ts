import { createClient } from '@supabase/supabase-js'
import type { Env } from '../../env'
import type { NetworkState } from './types'

/**
 * Mirrors the network state and every handoff into Supabase. Returns true only when every row was written;
 * anything deferred is retried by the next reconciliation.
 */
export async function archiveNetwork(env: Env, state: NetworkState): Promise<boolean> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return false
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const snapshot = await client
    .from('relay_network_snapshots')
    .upsert({ network: env.NIMIQ_NETWORK, version: state.version, payload: state, updated_at: new Date().toISOString() }, { onConflict: 'network' })
  if (snapshot.error) {
    console.error('Network archive deferred', snapshot.error.code)
    return false
  }
  for (const handoff of state.handoffs) {
    const row = { id: handoff.id, network: handoff.network, baton_id: handoff.batonId, leg: handoff.leg, tx_hash: handoff.txHash, payload: handoff }
    const result = await client.from('relay_network_handoffs').upsert(row, { onConflict: 'id', ignoreDuplicates: true })
    if (result.error) {
      console.error('Handoff archive deferred', result.error.code)
      return false
    }
  }
  return true
}
