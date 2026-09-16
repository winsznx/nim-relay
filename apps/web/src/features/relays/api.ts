import type {
  BatonChronicle,
  BatonDetail,
  CanonicalGhost,
  IssuedRace,
  LegProgressInput,
  LegProgressResult,
  NetworkConfirmation,
  NetworkHandoffIntent,
  NetworkInvite,
  NetworkSnapshot,
  OpsReport,
  RaceMode,
  RaceTrace,
  RunnerProfile,
  SubmittedRace,
  TrackEventInput,
  TrackEventResult,
} from '@nim-relay/shared'
import { messageForCode } from '../shell/errors'

/** A refusal from the relay server. `message` is player copy; `code` is for logic. */
export class NetworkApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(messageForCode(code))
    this.name = 'NetworkApiError'
  }
}

async function readError(response: Response): Promise<NetworkApiError> {
  const body: unknown = await response.json().catch(() => null)
  const code = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'request_failed'
  return new NetworkApiError(response.status, code)
}

async function send<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) throw await readError(response)
  return response.json() as Promise<T>
}

const request = <T>(path: string, body?: unknown) => send<T>(`/api/station/network${path}`, body)

export const loadNetwork = () => request<NetworkSnapshot>('')
export const loadPublicNetwork = () => request<NetworkSnapshot>('/public')
export const loadBaton = (code: string) => request<BatonDetail>(`/batons/${encodeURIComponent(code)}`)
export const loadChronicle = (code: string) => request<BatonChronicle>(`/chronicles/${encodeURIComponent(code)}`)
export const loadRunnerProfile = (handle: string) => request<RunnerProfile>(`/runners/${encodeURIComponent(handle.replace(/^@/, ''))}`)
export const createBaton = (input: { mode: Exclude<RaceMode, 'daily'>; title: string; recipient?: string; bestOf?: 3 | 5; crewId?: string }) =>
  request<BatonDetail>('/create', input)
export const issueNetworkRace = (input: { batonId?: string; daily?: boolean; practice?: boolean; ghostRunId?: string }) => request<IssuedRace>('/issue', input)
export const submitNetworkRace = (issued: IssuedRace, inputTrace: RaceTrace) => send<SubmittedRace>('/api/station/submit', { issued, inputTrace })
export const prepareNetworkHandoff = (runId: string, recipient: string, launch?: { angle: number; power: number }) =>
  request<NetworkHandoffIntent>('/handoff/prepare', { runId, recipient, throw: launch })
export const attemptNetworkHandoff = (id: string) => request<NetworkHandoffIntent>('/handoff/attempt', { id })
export const cancelNetworkHandoff = (id: string) => request<NetworkHandoffIntent>('/handoff/cancel', { id })
export const confirmNetworkHandoff = (id: string, txHash: string) => request<NetworkConfirmation>('/handoff/confirm', { id, txHash })
export const createNetworkInvite = (batonId: string) => request<NetworkInvite>('/invite', { batonId })
export const openNetworkInvite = (token: string) => request<NetworkInvite>(`/invites/${encodeURIComponent(token)}`)
export const claimNetworkInvite = (token: string) => request<BatonDetail>('/invite/claim', { token })
/** The reserved next runner confirms they will take the pass, so the reservation doesn't lapse. */
export const acceptReservation = (batonId: string) => request<BatonDetail>('/accept', { batonId })
export const trackEvent = (input: TrackEventInput) => request<TrackEventResult>('/track', input)
export const rematchBaton = (batonId: string) => request<BatonDetail>('/rematch', { batonId })
export const createNetworkCrew = (name: string) => request<NetworkSnapshot>('/crew/create', { name })
export const joinNetworkCrew = (code: string) => request<NetworkSnapshot>('/crew/join', { code })
export const createNetworkRival = (input: { title: string; opponent: string; target?: number }) => request<NetworkSnapshot>('/rival/create', input)
export const markNotificationRead = (id: string) => request<NetworkSnapshot>('/inbox/read', { id })
export const setCountryConsent = (consent: boolean) => request<NetworkSnapshot>('/consent', { consent })
export const networkHeartbeat = (seconds: number) => request<{ ok: true }>('/heartbeat', { seconds })
/** The holder's progress on the baton leg they are racing, for spectators. */
export const reportLegProgress = (input: LegProgressInput) => request<LegProgressResult>('/leg/progress', input)
export const loadVerifiedReplay = (runId: string) => request<CanonicalGhost>(`/replays/${encodeURIComponent(runId)}`)
/** Operators listed in the Worker's OPS_PLAYERS only; everyone else gets 403 `operators_only`. */
export const loadOpsReport = () => request<OpsReport>('/ops')
