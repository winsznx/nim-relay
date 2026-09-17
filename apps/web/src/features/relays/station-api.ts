import type { StationSnapshot } from '@nim-relay/shared'
import { messageForCode } from '../shell/errors'

/** A refusal from the station endpoints. `message` is player copy; `code` is for logic. */
export class StationApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(messageForCode(code))
    this.name = 'StationApiError'
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/station${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    const error: unknown = await response.json().catch(() => null)
    const code = error && typeof error === 'object' && 'error' in error && typeof error.error === 'string' ? error.error : 'request_failed'
    throw new StationApiError(response.status, code)
  }
  return response.json() as Promise<T>
}

/** The signed-in runner's courier profile, cosmetics and progression. */
export const loadStation = () => request<StationSnapshot>('')

export const customizeCourier = (input: { name?: string; category?: 'suit' | 'helmet' | 'board' | 'trail'; cosmetic?: string }) =>
  request<StationSnapshot>('/profile', input)
