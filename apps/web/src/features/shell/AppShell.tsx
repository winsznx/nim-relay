// The design system loads before any feature stylesheet, so feature rules refine it rather than race it.
import './ui/tokens.css'
import './ui/ui.css'
import './shell.css'
import { lazy, Suspense, type ReactElement } from 'react'
import { AnimatePresence } from 'motion/react'
import { useForegroundHeartbeat, useLiveUpdates, useRelays } from '../relays/data'
import { ChronicleScreen } from '../relays/ChronicleScreen'
import { JourneyScreen } from '../relays/JourneyScreen'
import { ProofScreen } from '../relays/ProofScreen'
import { CrewScreen } from '../social/CrewScreen'
import { DailyScreen } from '../social/DailyScreen'
import { InboxScreen } from '../social/InboxScreen'
import { InviteScreen } from '../social/InviteScreen'
import { NotFoundScreen } from '../social/NotFoundScreen'
import { PrivacyScreen } from '../social/PrivacyScreen'
import { ProfileScreen } from '../social/ProfileScreen'
import { RivalsScreen } from '../social/RivalsScreen'
import { RunnerScreen } from '../social/RunnerScreen'
import { StartRelayScreen } from '../social/StartRelayScreen'
import { WorldCanvas, type WorldFraming } from '../world/WorldCanvas'
import { WorldHome } from '../world/WorldHome'
import { BottomNav, PLAY_OVERLAY } from './BottomNav'
import { PlaySheet } from './PlaySheet'
import { matchRoute, useLocation, type AppLocation, type RouteMatch } from './router'
import { SIGN_IN_OVERLAY, useSession } from './session'
import { SignInSheet } from './SignInSheet'
import { ToastViewport } from './ui/overlays'
import { DepartureBanner } from '../leg/DepartureBanner'

const LegHost = lazy(() => import('./LegHost').then(module => ({ default: module.LegHost })))
const StationScreen = lazy(() => import('./StationScreen').then(module => ({ default: module.StationScreen })))

function screenFor(route: RouteMatch, location: AppLocation): ReactElement | null {
  const entry = location.key
  switch (route.name) {
    case 'world':
    case 'leg':
    case 'station':
      return null
    case 'relay':
      return <JourneyScreen key={entry} entryKey={entry} code={route.params.code} />
    case 'chronicle':
      return <ChronicleScreen key={entry} entryKey={entry} code={route.params.code} />
    case 'proof':
      return <ProofScreen key={entry} entryKey={entry} code={null} />
    case 'proofRelay':
      return <ProofScreen key={entry} entryKey={entry} code={route.params.code} />
    case 'inbox':
      return <InboxScreen key={entry} entryKey={entry} />
    case 'daily':
      return <DailyScreen key={entry} entryKey={entry} />
    case 'crew':
      return <CrewScreen key={entry} entryKey={entry} />
    case 'rivals':
      return <RivalsScreen key={entry} entryKey={entry} />
    case 'profile':
      return <ProfileScreen key={entry} entryKey={entry} />
    case 'runner':
      return <RunnerScreen key={entry} entryKey={entry} handle={route.params.handle} />
    case 'invite':
      return <InviteScreen key={entry} entryKey={entry} token={route.params.token} />
    case 'start':
      return <StartRelayScreen key={entry} entryKey={entry} />
    case 'privacy':
      return <PrivacyScreen key={entry} entryKey={entry} />
    case 'notFound':
      return <NotFoundScreen key={entry} entryKey={entry} />
  }
}

function framingFor(route: RouteMatch): WorldFraming {
  switch (route.name) {
    case 'world':
      return 'home'
    case 'relay':
    case 'chronicle':
    case 'proofRelay':
      return 'peek'
    default:
      return 'covered'
  }
}

function selectedCode(route: RouteMatch): string | null {
  return route.name === 'relay' || route.name === 'chronicle' || route.name === 'proofRelay' ? route.params.code : null
}

/**
 * The product frame: a living globe that never unmounts, the current screen as
 * a sheet above it, the bottom navigation and the app-wide overlays.
 */
export function AppShell() {
  const location = useLocation()
  const route = matchRoute(location.pathname)
  const { player } = useSession()
  const { relays, featured, state } = useRelays()
  useLiveUpdates()
  useForegroundHeartbeat(player !== null)

  const racing = route.name === 'leg'
  // The race and the station each draw their own 3D scene, so the globe pauses behind them.
  const globeActive = !racing && route.name !== 'station'
  const code = selectedCode(route)
  const selected = code ? (relays.find(relay => relay.code === code || relay.id === code) ?? null) : null
  const unread = state.snapshot?.inbox.filter(item => item.readAt === null).length ?? 0

  return (
    <div className="nr-app">
      <WorldCanvas relays={relays} featuredId={featured?.id ?? null} selectedId={selected?.id ?? null} framing={framingFor(route)} active={globeActive} />
      {racing ? (
        <Suspense fallback={<p className="nr-fullscreen-loading">Loading the race</p>}>
          <LegHost key={location.key} code={route.params.code} search={location.search} />
        </Suspense>
      ) : (
        <>
          {route.name === 'station' && (
            <Suspense fallback={<p className="nr-fullscreen-loading">Opening the Relay Station</p>}>
              <StationScreen />
            </Suspense>
          )}
          <AnimatePresence>{route.name === 'world' && <WorldHome key="world" player={player} relays={relays} featured={featured} network={state} />}</AnimatePresence>
          <AnimatePresence>{screenFor(route, location)}</AnimatePresence>
          <BottomNav current={route.name} unread={unread} />
        </>
      )}
      <PlaySheet open={location.overlay === PLAY_OVERLAY} playerId={player?.id ?? null} relays={relays} snapshot={state.snapshot} />
      <SignInSheet open={location.overlay === SIGN_IN_OVERLAY} />
      <DepartureBanner />
      <ToastViewport />
    </div>
  )
}
