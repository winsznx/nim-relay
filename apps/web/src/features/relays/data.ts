import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { BatonDetail, NetworkSnapshot, ShareSurface } from '@nim-relay/shared'
import * as station from '../../station/api'
import { useSession } from '../shell/session'
import * as api from './api'
import { isLiveUpdate } from './live'
import { featuredRelay, relayViews, toRelayView, type RelayView } from './model'

export const relayKeys = {
  publicNetwork: ['network-public'] as const,
  network: ['network'] as const,
  station: ['station'] as const,
  baton: (code: string) => ['baton', code] as const,
  chronicle: (code: string) => ['chronicle', code] as const,
  runner: (handle: string) => ['runner', handle] as const,
  invite: (token: string) => ['invite', token] as const,
  replay: (runId: string) => ['replay', runId] as const,
}

/** Minute-resolution clock for ages and "time alive". */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

export interface NetworkState {
  snapshot: NetworkSnapshot | undefined
  /** When `snapshot` arrived, on this client's clock. */
  receivedAt: number
  /** No snapshot has loaded yet. */
  loading: boolean
  /** The latest refresh failed; `snapshot` may still hold earlier data. */
  failed: boolean
  retry(): void
}

/** The signed-in snapshot when available, else the public one. Both refresh on live updates. */
export function useNetwork(): NetworkState {
  const { player } = useSession()
  const account = useQuery({ queryKey: relayKeys.network, queryFn: api.loadNetwork, enabled: !!player, refetchInterval: 20_000, retry: 1 })
  const showPublic = !player || (account.isError && !account.data)
  const publicNetwork = useQuery({ queryKey: relayKeys.publicNetwork, queryFn: api.loadPublicNetwork, enabled: showPublic, refetchInterval: 30_000, retry: 1 })
  const accountSnapshot = player ? account.data : undefined
  const snapshot = accountSnapshot ?? publicNetwork.data
  const active = showPublic ? publicNetwork : account
  return {
    snapshot,
    receivedAt: accountSnapshot ? account.dataUpdatedAt : publicNetwork.dataUpdatedAt,
    loading: !snapshot && (active.isPending || active.isFetching),
    failed: active.isError,
    retry: () => void active.refetch(),
  }
}

/** Runner id to Nimiq address, for identicons where only a runner's id and name travel. */
export function useRunnerWallets(): ReadonlyMap<string, string> {
  const { snapshot } = useNetwork()
  const runners = snapshot?.runners
  return useMemo(() => new Map((runners ?? []).map(runner => [runner.id, runner.wallet])), [runners])
}

export function useStationProfile() {
  const { player } = useSession()
  return useQuery({ queryKey: relayKeys.station, queryFn: station.loadStation, enabled: !!player, retry: 1 })
}

export function useRelays(): { relays: RelayView[]; featured: RelayView | null; state: NetworkState } {
  const state = useNetwork()
  const now = useNow(60_000)
  const relays = useMemo(() => (state.snapshot ? relayViews(state.snapshot, now) : []), [state.snapshot, now])
  return { relays, featured: featuredRelay(relays), state }
}

export function useBatonDetail(code: string | null) {
  return useQuery({
    queryKey: relayKeys.baton(code ?? ''),
    queryFn: () => api.loadBaton(code ?? ''),
    enabled: !!code,
    refetchInterval: 20_000,
    retry: retryUnlessRefused,
  })
}

/** Details for several batons at once, sharing the cache and refresh of `useBatonDetail`. */
export function useBatonDetails(codes: readonly string[]): BatonDetail[] {
  return useQueries({
    queries: codes.map(code => ({ queryKey: relayKeys.baton(code), queryFn: () => api.loadBaton(code), refetchInterval: 20_000, retry: retryUnlessRefused })),
    combine: results => results.flatMap(result => (result.data ? [result.data] : [])),
  })
}

/** A verified replay never changes once recorded, so it loads once per session. */
export function useVerifiedReplay(runId: string | null) {
  return useQuery({ queryKey: relayKeys.replay(runId ?? ''), queryFn: () => api.loadVerifiedReplay(runId ?? ''), enabled: !!runId, staleTime: Infinity, retry: retryUnlessRefused })
}

/** A relay view that prefers the detail record, so counts computed from handoffs are exact. */
export function useRelay(code: string | null): { relay: RelayView | null; detail: BatonDetail | undefined; query: ReturnType<typeof useBatonDetail> } {
  const query = useBatonDetail(code)
  const { snapshot } = useNetwork()
  const now = useNow()
  const detail = query.data
  const relay = useMemo(() => {
    const baton = detail?.baton ?? snapshot?.batons.find(item => item.code === code || item.id === code)
    return baton ? toRelayView(baton, { runners: snapshot?.runners ?? [], rivals: snapshot?.rivals ?? [], detail, now }) : null
  }, [detail, snapshot, code, now])
  return { relay, detail, query }
}

/** Refusals such as an unknown code are final; only server or network failures are worth one retry. */
const retryUnlessRefused = (count: number, error: unknown) => !(error instanceof api.NetworkApiError && error.status < 500) && count < 1

/** Each Chronicle load counts as a public view, so it is fetched once per visit rather than on every focus. */
export function useChronicle(code: string) {
  return useQuery({ queryKey: relayKeys.chronicle(code), queryFn: () => api.loadChronicle(code), retry: retryUnlessRefused, staleTime: 5 * 60_000, refetchOnWindowFocus: false })
}

export function useRunnerProfile(handle: string | null) {
  return useQuery({ queryKey: relayKeys.runner(handle ?? ''), queryFn: () => api.loadRunnerProfile(handle ?? ''), enabled: !!handle, retry: retryUnlessRefused })
}

/** `liveOnly` when only legs in progress changed, which leaves the station profile as it was. */
function refreshNetwork(client: QueryClient, liveOnly = false): void {
  // Chronicles are left out on purpose: every Chronicle load is counted as a view.
  for (const queryKey of [relayKeys.network, relayKeys.publicNetwork, ['baton'], ...(liveOnly ? [] : [relayKeys.station])]) void client.invalidateQueries({ queryKey })
}


export function useRefreshNetwork(): () => void {
  const client = useQueryClient()
  return () => refreshNetwork(client)
}

type LiveStatus = 'connecting' | 'live' | 'offline'
let liveStatus: LiveStatus = 'connecting'
const liveListeners = new Set<() => void>()
function setLiveStatus(next: LiveStatus): void {
  if (liveStatus === next) return
  liveStatus = next
  for (const listener of liveListeners) listener()
}

export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(
    listener => {
      liveListeners.add(listener)
      return () => liveListeners.delete(listener)
    },
    () => liveStatus,
    () => liveStatus,
  )
}

/** Subscribes to the relay room and refreshes relay data whenever a baton changes. Reconnects with backoff. */
export function useLiveUpdates(): void {
  const client = useQueryClient()
  useEffect(() => {
    let socket: WebSocket | null = null
    let attempts = 0
    let timer = 0
    let closed = false
    const connect = () => {
      setLiveStatus('connecting')
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/network`)
      socket.onopen = () => {
        attempts = 0
        setLiveStatus('live')
      }
      socket.onmessage = event => refreshNetwork(client, isLiveUpdate(event.data))
      socket.onclose = () => {
        if (closed) return
        setLiveStatus('offline')
        timer = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempts++))
      }
    }
    // Deferred so a mount that is immediately undone (React StrictMode) never opens a socket.
    timer = window.setTimeout(connect, 0)
    return () => {
      closed = true
      window.clearTimeout(timer)
      socket?.close()
    }
  }, [client])
}

/** Reports bounded foreground time for signed-in runners, as the privacy page describes. */
export function useForegroundHeartbeat(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    let last = performance.now()
    const beat = () => {
      const now = performance.now()
      const seconds = Math.min(30, Math.floor((now - last) / 1000))
      if (!document.hidden && seconds > 0) {
        api.networkHeartbeat(seconds).catch((error: unknown) => console.warn('Foreground heartbeat not recorded', error))
      }
      last = now
    }
    const resetOnReturn = () => {
      last = performance.now()
    }
    const timer = window.setInterval(beat, 15_000)
    document.addEventListener('visibilitychange', resetOnReturn)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', resetOnReturn)
    }
  }, [enabled])
}

const VISITOR_KEY = 'nim-relay-visitor'

function visitorKey(): string | undefined {
  try {
    const existing = localStorage.getItem(VISITOR_KEY)
    if (existing) return existing
    const created = crypto.randomUUID()
    localStorage.setItem(VISITOR_KEY, created)
    return created
  } catch {
    // Storage can be blocked in private browsing; the share is then counted without a visitor key.
    return undefined
  }
}

/** Counts a share for the public usage metrics. Best effort: a failed count never blocks the share itself. */
export function trackShare(surface: ShareSurface): void {
  const visitor = visitorKey()
  api.trackEvent({ kind: 'share', surface, ...(visitor ? { visitor } : {}) }).catch((error: unknown) => console.warn('Share was not counted', error))
}
