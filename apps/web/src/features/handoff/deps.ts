import { sendRelayHandoff } from '../../lib/nimiq'
import { readTransfer, saveTransfer } from '../../station/transfer-store'
import * as api from '../relays/api'
import type { HandoffDeps } from './machine'

const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms))

/** The production wiring of a handoff: relay API, native Nimiq Pay approval, and local recovery records. */
export const handoffDeps: HandoffDeps = {
  prepare: (runId, recipientId, launch) => api.prepareNetworkHandoff(runId, recipientId, launch),
  attempt: id => api.attemptNetworkHandoff(id),
  cancel: id => api.cancelNetworkHandoff(id),
  confirm: (id, hash) => api.confirmNetworkHandoff(id, hash),
  send: intent => sendRelayHandoff(intent),
  readTransfer,
  saveTransfer,
  wait,
}
