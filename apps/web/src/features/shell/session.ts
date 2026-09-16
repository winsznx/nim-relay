import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { fetchMe, logout, requestNonce, verifyLogin, type Player } from '../../lib/auth-api'
import { connectAccount, deviceIdentifier, signMessage } from '../../lib/nimiq'
import { closeOverlay, getLocation, openOverlay } from './router'

export const SESSION_KEY = ['me'] as const
export const SIGN_IN_OVERLAY = 'sign-in'
const FAIR_PLAY_REASON = 'Fair play: recognise repeated Daily attempts without storing your device identifier.'

export interface Session {
  player: Player | null
  /** True until the first session check finishes. */
  checking: boolean
}

export function useSession(): Session {
  const query = useQuery({ queryKey: SESSION_KEY, queryFn: fetchMe, retry: false, staleTime: 5 * 60_000 })
  return { player: query.data ?? null, checking: query.isPending }
}

/** Queries that only make sense for the signed-in runner. */
const ACCOUNT_QUERIES = [['network'], ['station'], ['baton'], ['ops-report']] as const

let ceremony: Promise<Player> | null = null

/**
 * The one sign-in ceremony: pick the Nimiq Pay account, sign the server's
 * challenge, receive a session cookie. Concurrent callers share the same run.
 */
export function signIn(client: QueryClient, options: { fairPlay: boolean }): Promise<Player> {
  ceremony ??= (async () => {
    await connectAccount()
    const deviceId = options.fairPlay ? await deviceIdentifier(FAIR_PLAY_REASON) : undefined
    const challenge = await requestNonce()
    const signed = await signMessage(challenge.message)
    const { player } = await verifyLogin({ nonce: challenge.nonce, ...signed, ...(deviceId ? { deviceId } : {}) })
    client.setQueryData(SESSION_KEY, player)
    for (const queryKey of ACCOUNT_QUERIES) void client.invalidateQueries({ queryKey })
    return player
  })().finally(() => {
    ceremony = null
  })
  return ceremony
}

export async function signOut(client: QueryClient): Promise<void> {
  await logout()
  client.setQueryData(SESSION_KEY, null)
  for (const queryKey of ACCOUNT_QUERIES) client.removeQueries({ queryKey })
}

interface RunnerGateState {
  reason: string | null
  continuation: (() => void) | null
  request(reason: string, continuation: () => void): void
  clear(): void
}

export const useRunnerGate = create<RunnerGateState>(set => ({
  reason: null,
  continuation: null,
  request: (reason, continuation) => set({ reason, continuation }),
  clear: () => set({ reason: null, continuation: null }),
}))

/**
 * Runs `action` immediately for a signed-in runner. Otherwise it opens the
 * sign-in sheet once, then continues with the same action after success.
 */
export function useRequireRunner(): (reason: string, action: () => void) => void {
  const client = useQueryClient()
  const request = useRunnerGate(state => state.request)
  return (reason, action) => {
    const openGate = () => {
      request(reason, action)
      openOverlay(SIGN_IN_OVERLAY)
    }
    const known = client.getQueryData<Player | null>(SESSION_KEY)
    // Decide synchronously when the session is known, so actions keep the tap's user activation.
    if (known) action()
    else if (known === null) openGate()
    else {
      // The first session check is still running; a returning runner must not be asked to sign in again.
      client
        .ensureQueryData({ queryKey: SESSION_KEY, queryFn: fetchMe })
        .then(player => (player ? action() : openGate()))
        .catch(openGate)
    }
  }
}

/** Called by the sign-in sheet after a successful ceremony. */
export function continueAfterSignIn(): void {
  const { continuation, clear } = useRunnerGate.getState()
  clear()
  continuation?.()
  // A continuation that navigated has already replaced the overlay entry.
  if (getLocation().overlay === SIGN_IN_OVERLAY) closeOverlay()
}
