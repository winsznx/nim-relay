import { lazy, Suspense } from 'react'

const AppShell = lazy(() => import('../features/shell/AppShell').then(module => ({ default: module.AppShell })))

// Development labs render outside the product shell. Production builds drop them entirely.
const LegLab = import.meta.env.DEV ? lazy(() => import('../features/race/dev/LegLab').then(module => ({ default: module.LegLab }))) : null
const StationLab = import.meta.env.DEV ? lazy(() => import('../features/relay-station/dev/StationLab').then(module => ({ default: module.StationLab }))) : null

/** Every path belongs to the relay product shell, which routes in-app, apart from the development labs. */
export function App() {
  const path = window.location.pathname
  if (LegLab && path === '/dev/leg') {
    return <Suspense fallback={null}><LegLab /></Suspense>
  }
  if (StationLab && path === '/dev/station') {
    return <Suspense fallback={null}><StationLab /></Suspense>
  }
  return <Suspense fallback={null}><AppShell /></Suspense>
}
