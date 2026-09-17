import type { GrantClaimResult, GrantMilestoneId, GrantsOpsReport, GrantsSummary, GrantsView } from '@nim-relay/shared'
import { NetworkApiError } from '../relays/api'

async function send<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/station/network/grants${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    const error: unknown = await response.json().catch(() => null)
    const code = error && typeof error === 'object' && 'error' in error && typeof error.error === 'string' ? error.error : 'request_failed'
    throw new NetworkApiError(response.status, code)
  }
  return response.json() as Promise<T>
}

/** The signed-in runner's Relay Grants: every milestone with its state, and what they claimed against the cap. */
export const loadGrants = () => send<GrantsView>('')
/** Names the milestone only. The server decides the recipient, the amount and whether it pays. */
export const claimGrant = (grantId: GrantMilestoneId) => send<GrantClaimResult>('/claim', { grantId })
export const loadGrantsSummary = () => send<GrantsSummary>('/summary')
/** Operators only. */
export const loadGrantsOps = () => send<GrantsOpsReport>('/ops')
/** Operators only: stops or resumes new grant transfers at once. */
export const pauseGrants = (paused: boolean) => send<GrantsOpsReport>('/pause', { paused })
