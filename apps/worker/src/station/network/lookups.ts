import type { BatonHandoff, HandoffRace, NetworkHandoffIntent, NetworkNotification } from '@nim-relay/shared'
import { ApiError, type Profile, type Run } from '../model'
import { MAX_NOTIFICATIONS } from './constants'
import type { BatonRecord, NetworkState } from './types'

export type RacedHandoff = BatonHandoff & { race: HandoffRace; sector: number }

export function findBaton(state: NetworkState, idOrCode: string): BatonRecord {
  const baton = state.batons[idOrCode] ?? Object.values(state.batons).find(candidate => candidate.code === idOrCode)
  if (!baton) throw new ApiError('journey_not_found', 404)
  return baton
}

export function assertHolder(baton: BatonRecord, profile: Profile): void {
  if (baton.holder.id !== profile.id) throw new ApiError('only_current_holder_can_pass', 403)
  if (baton.status === 'completed') throw new ApiError('journey_completed', 409)
}

/** Prepared, attempted or submitted: the holder may already have approved this transfer. */
export function isOpenIntent(intent: NetworkHandoffIntent): boolean {
  return intent.state === 'prepared' || intent.state === 'attempting' || intent.state === 'submitted'
}

export function openIntentFor(state: NetworkState, batonId: string): NetworkHandoffIntent | null {
  return Object.values(state.intents).find(intent => intent.batonId === batonId && isOpenIntent(intent)) ?? null
}

export function handoffsOf(state: NetworkState, batonId: string): BatonHandoff[] {
  return state.handoffs.filter(handoff => handoff.batonId === batonId)
}

export function handoffsSentBy(state: NetworkState, playerId: string): BatonHandoff[] {
  return state.handoffs.filter(handoff => handoff.qualified && handoff.from.id === playerId)
}

export function isRaced(handoff: BatonHandoff): handoff is RacedHandoff {
  return handoff.race !== null && handoff.sector !== null
}

export async function loadRun(storage: DurableObjectStorage, runId: string | null): Promise<Run | undefined> {
  if (!runId) return undefined
  return storage.get<Run>(`run:${runId}`)
}

export function outscores(run: { completed: boolean; score: number }, rival: { score: number }): boolean {
  return run.completed && run.score > rival.score
}

interface NotificationInput {
  type: NetworkNotification['type']
  title: string
  body: string
  batonId: string | null
  runId?: string | null
}

export function notify(state: NetworkState, playerId: string, input: NotificationInput): void {
  const notification: NetworkNotification = {
    id: crypto.randomUUID(),
    type: input.type,
    title: input.title,
    body: input.body,
    batonId: input.batonId,
    runId: input.runId ?? null,
    createdAt: Date.now(),
    readAt: null,
  }
  const inbox = state.notifications[playerId] ?? []
  state.notifications[playerId] = [notification, ...inbox].slice(0, MAX_NOTIFICATIONS)
}
