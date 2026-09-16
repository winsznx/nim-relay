import type { BatonDetail, CanonicalGhost, IssuedRace, NetworkConfirmation, NetworkHandoffIntent, NetworkInvite, NetworkSnapshot, RaceMode, RaceTrace, SubmittedRace } from '@nim-relay/shared'
export type * from '@nim-relay/shared'
export class NetworkApiError extends Error { constructor(readonly status: number, readonly code: string) { super(code.replaceAll('_', ' ')); this.name = 'NetworkApiError' } }
async function request<T>(path: string, body?: unknown): Promise<T> {
 const response = await fetch(`/api/station/network${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'include', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
 if (!response.ok) { const error = await response.json() as { error?: string }; throw new NetworkApiError(response.status, error.error ?? 'request_failed') }
 return response.json() as Promise<T>
}
export const loadNetwork = () => request<NetworkSnapshot>('')
export const loadPublicNetwork = () => request<NetworkSnapshot>('/public')
export const loadBaton = (code: string) => request<BatonDetail>(`/batons/${encodeURIComponent(code)}`)
export const createBaton = (input: { mode: Exclude<RaceMode,'daily'>; title: string; recipient?: string; bestOf?: 3 | 5; crewId?: string }) => request<BatonDetail>('/create', input)
export const issueNetworkRace = (input: { batonId?: string; daily?: boolean; practice?: boolean; ghostRunId?: string }) => request<IssuedRace>('/issue', input)
export async function submitNetworkRace(issued: IssuedRace, inputTrace: RaceTrace): Promise<SubmittedRace> { const response = await fetch('/api/station/submit', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify({issued,inputTrace}) }); if(!response.ok) {const error=await response.json() as {error?:string};throw new NetworkApiError(response.status,error.error??'request_failed')} return response.json() as Promise<SubmittedRace> }
export const prepareNetworkHandoff = (runId: string, recipient: string, launch?: {angle:number;power:number}) => request<NetworkHandoffIntent>('/handoff/prepare', {runId,recipient,throw:launch})
export const attemptNetworkHandoff = (id:string) => request<NetworkHandoffIntent>('/handoff/attempt',{id})
export const cancelNetworkHandoff = (id:string) => request<NetworkHandoffIntent>('/handoff/cancel',{id})
export const confirmNetworkHandoff = (id:string,txHash:string) => request<NetworkConfirmation>('/handoff/confirm',{id,txHash})
export const createNetworkInvite = (batonId:string) => request<NetworkInvite>('/invite',{batonId})
export const openNetworkInvite = (token:string) => request<NetworkInvite>(`/invites/${encodeURIComponent(token)}`)
export const claimNetworkInvite = (token:string) => request<BatonDetail>('/invite/claim',{token})
export const rematchBaton = (batonId:string) => request<BatonDetail>('/rematch',{batonId})
export const createNetworkCrew = (name:string) => request<NetworkSnapshot>('/crew/create',{name})
export const joinNetworkCrew = (code:string) => request<NetworkSnapshot>('/crew/join',{code})
export const createNetworkRival = (input:{title:string;opponent:string;target?:number}) => request<NetworkSnapshot>('/rival/create',input)
export const markNotificationRead = (id:string) => request<NetworkSnapshot>('/inbox/read',{id})
export const setCountryConsent = (consent:boolean) => request<NetworkSnapshot>('/consent',{consent})
export const networkHeartbeat = (seconds:number) => request<{ok:true}>('/heartbeat',{seconds})
export const loadVerifiedReplay = (runId:string) => request<CanonicalGhost>(`/replays/${encodeURIComponent(runId)}`)
