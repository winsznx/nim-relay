import type { LocateRequest } from './controller'
import type { TourRect } from './types'

/** Finding and framing tour targets in the live DOM. */

/** Re-checks between DOM changes too, since becoming visible doesn't always change the tree. */
const POLL_MS = 120
/** A fallback only counts once the step's own target has had this long to appear alongside it. */
const FALLBACK_GRACE_MS = 250
/** Room the sheet header or top bar takes before a target counts as comfortably on screen. */
const TOP_CLEARANCE = 56

export function tourTarget(id: string): string {
  return `[data-tour="${id}"]`
}

/** Connected, laid out, not hidden and not inside a sheet on its way out. */
export function isUsableTarget(element: Element): boolean {
  if (!element.isConnected || element.closest('[inert]')) return false
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden'
}

export function rectOf(element: Element): TourRect {
  const rect = element.getBoundingClientRect()
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
}

/**
 * Waits for the first selector with a usable element, watching DOM changes and polling, until the request is
 * aborted. It never resolves on its own after the abort, so the caller's timeout bounds every wait.
 */
export function locateTarget({ selectors, signal, measure }: LocateRequest): Promise<{ element: Element; index: number } | null> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      resolve(null)
      return
    }
    let fallbackSince: number | null = null
    const observer = new MutationObserver(() => check())
    const timer = window.setInterval(() => check(), POLL_MS)
    const onAbort = () => finish(null)
    function finish(found: { element: Element; index: number } | null): void {
      observer.disconnect()
      window.clearInterval(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(found)
    }
    function find(): { element: Element; index: number } | null {
      for (const [index, selector] of selectors.entries()) {
        for (const element of document.querySelectorAll(selector)) {
          if (!isUsableTarget(element)) continue
          if (index === 0 && measure && measure(element) === null) continue
          return { element, index }
        }
      }
      return null
    }
    function check(): void {
      try {
        const found = find()
        if (!found) {
          fallbackSince = null
          return
        }
        if (found.index > 0) {
          fallbackSince ??= performance.now()
          if (performance.now() - fallbackSince < FALLBACK_GRACE_MS) return
        }
        finish(found)
      } catch (error) {
        // A selector the browser can't parse: fail the step rather than wait on it.
        observer.disconnect()
        window.clearInterval(timer)
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    }
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-tour', 'inert', 'hidden'] })
    signal.addEventListener('abort', onAbort, { once: true })
    check()
  })
}

function scrollingAncestor(element: Element): Element | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent)
    if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) return parent
  }
  return null
}

/**
 * Scrolls a target into its sheet's view when it's hidden under the header or the bottom navigation. Targets in
 * fixed layers such as the navigation or the globe are always on screen and are left alone.
 */
export function revealTarget(element: Element): void {
  if (!scrollingAncestor(element)) return
  const rect = element.getBoundingClientRect()
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight
  const nav = document.querySelector(tourTarget('bottom-nav'))
  const inNav = nav?.contains(element) ?? false
  const navTop = nav && !inNav ? nav.getBoundingClientRect().top : viewportHeight
  const bottom = Math.min(viewportHeight, navTop)
  if (inNav) return
  // A target taller than the visible area only needs its top in view.
  const fits = rect.height <= bottom - TOP_CLEARANCE
  const visible = rect.top >= TOP_CLEARANCE && (fits ? rect.bottom <= bottom : rect.top < bottom)
  if (visible) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element.scrollIntoView({ block: fits ? 'center' : 'start', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
}
