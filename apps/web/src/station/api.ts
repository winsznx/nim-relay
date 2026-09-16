import type { HandoffIntent, IssuedRace, RaceMode, RaceTrace, StationRaceConfig, StationRaceGhost, StationSnapshot, StationWorld, SubmittedRace } from '@nim-relay/shared'
export type * from '@nim-relay/shared'
/** The station route only issues v4 races with v4 ghosts. */
export type StationIssuedRace = IssuedRace & { config: StationRaceConfig; ghost: StationRaceGhost | null }
export class StationApiError extends Error { constructor(readonly status: number, readonly code: string) { super(code.replaceAll('_', ' ')); this.name = 'StationApiError' } }
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/station${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'include', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  if (!response.ok) { const error = await response.json() as { error?: string }; throw new StationApiError(response.status, error.error ?? 'request_failed') }
  return response.json() as Promise<T>
}
export const loadStation = () => request<StationSnapshot>('')
export const publicStationSummary = () => request<Pick<StationSnapshot, 'global' | 'chronicles' | 'rankings'>>('/public')
export const issueRace = (input: { mode: RaceMode; world: StationWorld; target?: string }) => request<StationIssuedRace>('/issue', input)
export const submitRace = (issued: IssuedRace, inputTrace: RaceTrace) => request<SubmittedRace>('/submit', { issued, inputTrace })
export const prepareHandoff = (runId: string, recipient: string, launch?: { angle: number; power: number }) => request<HandoffIntent>('/handoff/prepare', { runId, recipient, throw: launch })
export const confirmHandoff = (id: string, txHash: string) => request<{ status: 'pending' | 'rejected' | 'verified'; reason?: string; intent?: HandoffIntent }>('/handoff/confirm', { id, txHash })
export const createCrew = (name: string) => request<StationSnapshot>('/crew/create', { name })
export const joinCrew = (code: string) => request<StationSnapshot>('/crew/join', { code })
export const challengeRunner = (recipient: string, runId: string) => request<StationSnapshot>('/challenge', { recipient, runId })
export const addRival = (recipient: string) => request<StationSnapshot>('/rival', { recipient })
export const customizeCourier = (input: { name?: string; category?: 'suit' | 'helmet' | 'board' | 'trail'; cosmetic?: string }) => request<StationSnapshot>('/profile', input)
