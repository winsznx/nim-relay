import { lazy, Suspense } from 'react'

const AppShell = lazy(() => import('../features/shell/AppShell').then(module => ({ default: module.AppShell })))
const StationApp = lazy(() => import('../station/StationApp').then(module => ({ default: module.StationApp })))
const GamePage = lazy(() => import('../game/GamePage').then(module => ({ default: module.GamePage })))
const RelayRunLab = lazy(() => import('../lab/relay-run/RelayRunLab').then(module => ({ default: module.RelayRunLab })))
const RelayRaceLab = lazy(() => import('../lab/relay-race/RelayRaceLab').then(module => ({ default: module.RelayRaceLab })))

const LegLab = lazy(() => import('../features/race/dev/LegLab').then(module => ({ default: module.LegLab })))
const StationLab = lazy(() => import('../features/relay-station/dev/StationLab').then(module => ({ default: module.StationLab })))

/**
 * Standalone development and legacy surfaces keep their own entry points.
 * Every other path belongs to the relay product shell, which routes in-app.
 */
export function App() {
  const path = window.location.pathname
  if (path === '/dev/leg') {
    return <Suspense fallback={null}><LegLab /></Suspense>
  }
  if (path === '/dev/station') {
    return <Suspense fallback={null}><StationLab /></Suspense>
  }
  if (path === '/station-v4') {
    return <Suspense fallback={<p>Preparing your departure…</p>}><StationApp /></Suspense>
  }
  if (path === '/practice-v1') {
    return <Suspense fallback={<p>Loading solo practice…</p>}><GamePage /></Suspense>
  }
  if (path === '/lab/relay-run-v2' || path === '/lab/relay-run-v2/') {
    return <Suspense fallback={<p>Loading lab…</p>}><RelayRunLab /></Suspense>
  }
  if (path === '/lab/relay-race-v3' || path === '/lab/relay-race-v3/') {
    return <Suspense fallback={<p>Loading…</p>}><RelayRaceLab /></Suspense>
  }
  return <Suspense fallback={<ShellLoading />}><AppShell /></Suspense>
}

/** Shown while the world loads; plain inline styles because the shell's stylesheets arrive with it. */
function ShellLoading() {
  return (
    <div role="status" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#04060d', color: '#9aa3b8', font: '700 13px/1 var(--font-display)', letterSpacing: '0.24em' }}>
      NIM RELAY
    </div>
  )
}
