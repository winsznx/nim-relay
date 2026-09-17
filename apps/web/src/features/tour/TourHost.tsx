import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AnimatePresence } from 'motion/react'
import type { Player } from '../../lib/auth-api'
import { useDeparture } from '../leg/departure'
import type { NetworkState } from '../relays/data'
import type { RelayView } from '../relays/model'
import { getLocation, matchRoute, type AppLocation, type RouteMatch } from '../shell/router'
import { globeStatus, subscribeGlobeStatus } from '../world/globe-bridge'
import { trackTourEvent } from './analytics'
import { CORE_TOUR_ID, CORE_TOUR_VERSION, coreTour, type CoreTourContext } from './core-tour'
import { entryRouteOf } from './entry-route'
import { registerTourLauncher } from './launch'
import { browserSessionStore, hasUrgentState, isUrgentRoute, offerDecision, readSessionFlags, writeSessionFlags, type TourPrompt, type TourSessionFlags } from './offer'
import { tourController } from './runtime'
import { useTourPreferencesSync, useTourState, writeTourState } from './state'
import { TourBoundary } from './TourBoundary'
import { TourLayer } from './TourLayer'
import { TourNudge, TourOffer } from './TourPrompts'
import './tour.css'

/** How long the world home must stay calm before the offer appears, so it never pops in while the home fades up. */
const PROMPT_SETTLE_MS = 900
/** A globe that is neither ready nor failed by then no longer holds the offer back. */
const GLOBE_WAIT_MS = 8_000

interface TourHostProps {
  route: RouteMatch
  location: AppLocation
  player: Player | null
  /** The first session check hasn't finished. */
  checking: boolean
  featured: RelayView | null
  network: NetworkState
}

function useSessionFlags(): [TourSessionFlags, (next: Partial<TourSessionFlags>) => void] {
  const [flags, setFlags] = useState(() => readSessionFlags(CORE_TOUR_ID, CORE_TOUR_VERSION, browserSessionStore))
  const latest = useRef(flags)
  const update = useCallback((next: Partial<TourSessionFlags>) => {
    const merged = { ...latest.current, ...next }
    latest.current = merged
    writeSessionFlags(CORE_TOUR_ID, CORE_TOUR_VERSION, merged, browserSessionStore)
    setFlags(merged)
  }, [])
  return [flags, update]
}

function useGlobeSettled(): boolean {
  const status = useSyncExternalStore(subscribeGlobeStatus, globeStatus, globeStatus)
  const [waitedOut, setWaitedOut] = useState(false)
  useEffect(() => {
    if (status !== 'pending') return
    const timer = window.setTimeout(() => setWaitedOut(true), GLOBE_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [status])
  return status !== 'pending' || waitedOut
}

/**
 * Owns the product tour in the app: offers it on a genuine first visit, holds it back while something urgent needs
 * the runner, starts it from the offer or a replay request, and draws it while it runs.
 */
export function TourHost({ route, location, player, checking, featured, network }: TourHostProps) {
  const snapshot = useSyncExternalStore(tourController.subscribe, tourController.getSnapshot, tourController.getSnapshot)
  const tourState = useTourState(CORE_TOUR_ID, CORE_TOUR_VERSION)
  const synced = useTourPreferencesSync(player?.id ?? null)
  const globeSettled = useGlobeSettled()
  const departing = useDeparture(state => state.current !== null)
  const [entryPath] = useState(() => getLocation().pathname)
  const [flags, updateFlags] = useSessionFlags()
  const [prompt, setPrompt] = useState<TourPrompt | null>(null)

  const context: CoreTourContext = { featuredCode: featured?.code ?? null, ghostOnJourney: Boolean(featured?.previousRunId) }
  const latestContext = useRef(context)
  useLayoutEffect(() => {
    latestContext.current = context
  })
  const start = useCallback(
    (mode: 'first-run' | 'replay') => tourController.start(coreTour(latestContext.current), { mode, entryRoute: entryRouteOf(entryPath) }),
    [entryPath],
  )
  useEffect(() => registerTourLauncher(start), [start])

  const touring = snapshot.phase !== 'idle'
  const urgent = isUrgentRoute(route.name) || hasUrgentState(network.snapshot, player?.id ?? null) || departing
  const onWorldHome = route.name === 'world' && location.overlay === null
  const decision = offerDecision({
    tourState,
    touring,
    settled: !checking && synced.settled && !network.loading && globeSettled,
    urgent,
    entryUrgent: isUrgentRoute(matchRoute(entryPath).name),
    onWorldHome,
    flags,
  })

  // Remembered for the session, so a reload mid-handoff still only earns the quiet prompt.
  useEffect(() => {
    if (decision === 'defer') updateFlags({ deferred: true })
  }, [decision, updateFlags])

  const candidate = decision === 'offer' || decision === 'nudge' ? decision : null
  useEffect(() => {
    if (!candidate) return
    const timer = window.setTimeout(() => {
      setPrompt(candidate)
      updateFlags(candidate === 'offer' ? { offered: true } : { nudged: true })
      trackTourEvent({ event: 'offered', tourId: CORE_TOUR_ID, version: CORE_TOUR_VERSION, entryRoute: entryRouteOf(entryPath) })
    }, PROMPT_SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [candidate, updateFlags, entryPath])

  // A prompt that loses its calm world home is gone for this session.
  const promptVisible = prompt !== null && tourState === 'not_seen' && !touring && onWorldHome && !urgent
  if (prompt !== null && !promptVisible) setPrompt(null)

  const accept = () => {
    setPrompt(null)
    start('first-run')
  }
  const decline = () => {
    setPrompt(null)
    writeTourState(CORE_TOUR_ID, CORE_TOUR_VERSION, 'skipped')
    trackTourEvent({ event: 'skipped', tourId: CORE_TOUR_ID, version: CORE_TOUR_VERSION, entryRoute: entryRouteOf(entryPath) })
  }

  return (
    <>
      <AnimatePresence>
        {promptVisible && prompt === 'offer' && <TourOffer key="offer" onAccept={accept} onDecline={decline} />}
        {promptVisible && prompt === 'nudge' && <TourNudge key="nudge" onAccept={accept} onDismiss={() => setPrompt(null)} />}
      </AnimatePresence>
      {snapshot.phase !== 'idle' && (
        <TourBoundary key={snapshot.runId} onError={error => tourController.abort(error)}>
          <TourLayer snapshot={snapshot} controller={tourController} />
        </TourBoundary>
      )}
    </>
  )
}
