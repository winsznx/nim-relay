import { getLocation, navigate, subscribeLocation } from '../shell/router'
import { trackTourEvent } from './analytics'
import { TourController } from './controller'
import { writeTourState } from './state'
import { locateTarget, revealTarget } from './targets'

/** The app's one tour controller, wired to the router, the DOM, progress storage and analytics. */
export const tourController = new TourController<Element>({
  navigate: (path, options) => navigate(path, options),
  currentPath: () => getLocation().pathname,
  subscribeToPath: subscribeLocation,
  locate: locateTarget,
  reveal: revealTarget,
  persist: (tourId, version, state) => {
    writeTourState(tourId, version, state)
  },
  track: trackTourEvent,
  reportMissing: message => {
    if (import.meta.env.DEV) console.warn(message)
  },
  reportError: error => console.error('The tour closed after an error', error),
  captureFocus: () => {
    const focused = document.activeElement
    return () => {
      if (focused instanceof HTMLElement && focused !== document.body && focused.isConnected) focused.focus({ preventScroll: true })
    }
  },
  defer: work => {
    window.setTimeout(work, 0)
  },
})
