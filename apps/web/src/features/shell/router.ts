import { useLayoutEffect, useSyncExternalStore, type MouseEvent, type RefObject } from 'react'

/**
 * A deliberately small History API router. Screens are sheets over a persistent
 * world, so the router also owns what native back means for overlays and
 * restores each sheet's scroll position when the player returns to it.
 */

const ROUTES = {
  world: '/',
  relay: '/relay/:code',
  chronicle: '/chronicle/:code',
  proof: '/proof',
  proofRelay: '/proof/relay/:code',
  inbox: '/inbox',
  daily: '/daily',
  crew: '/crew',
  rivals: '/rivals',
  profile: '/profile',
  runner: '/runner/:handle',
  invite: '/invite/:token',
  start: '/start',
  privacy: '/privacy',
  station: '/station',
  leg: '/leg/:code',
} as const

export type RouteName = keyof typeof ROUTES
type ParamNames<Path extends string> = Path extends `${string}:${infer Param}/${infer Rest}`
  ? Param | ParamNames<`/${Rest}`>
  : Path extends `${string}:${infer Param}`
    ? Param
    : never
export type RouteParams<Name extends RouteName> = { [Key in ParamNames<(typeof ROUTES)[Name]>]: string }

export type RouteMatch = { [Name in RouteName]: { name: Name; params: RouteParams<Name> } }[RouteName] | { name: 'notFound'; params: Record<string, never> }

/** Paths from earlier releases that are still shared in the wild. */
const LEGACY_REDIRECTS: readonly (readonly [RegExp, (match: RegExpMatchArray) => string])[] = [
  [/^\/(?:r|journey)\/([^/]+)\/?$/, match => `/relay/${match[1] ?? ''}`],
  [/^\/crews\/?$/, () => '/crew'],
  [/^\/create\/?$/, () => '/start'],
  [/^\/home\/?$/, () => '/station'],
  [/^\/vault\/?$/, () => '/profile'],
  [/^\/play\/?$/, () => '/'],
]

const COMPILED = (Object.entries(ROUTES) as [RouteName, string][]).map(([name, path]) => {
  const keys: string[] = []
  const source = path
    .split('/')
    .map(segment => {
      if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      keys.push(segment.slice(1))
      return '([^/]+)'
    })
    .join('/')
  return { name, keys, pattern: new RegExp(`^${source === '' ? '/' : source}/?$`) }
})

export function matchRoute(pathname: string): RouteMatch {
  for (const route of COMPILED) {
    const found = pathname.match(route.pattern)
    if (!found) continue
    const params: Record<string, string> = {}
    route.keys.forEach((key, index) => {
      params[key] = safeDecode(found[index + 1] ?? '')
    })
    return { name: route.name, params } as RouteMatch
  }
  return { name: 'notFound', params: {} }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function pathFor<Name extends RouteName>(name: Name, ...args: [ParamNames<(typeof ROUTES)[Name]>] extends [never] ? [] : [RouteParams<Name>]): string {
  const params: Partial<Record<string, string>> = args[0] ?? {}
  return ROUTES[name].replace(/:([a-zA-Z]+)/g, (_, key: string) => encodeURIComponent(params[key] ?? ''))
}

export interface AppLocation {
  pathname: string
  search: string
  hash: string
  /** Stable identity of this history entry, used for scroll restoration. */
  key: string
  /** Depth inside this app's history; 0 means back would leave the app. */
  index: number
  overlay: string | null
}

interface EntryState {
  key: string
  index: number
  overlay: string | null
}

function readEntryState(value: unknown): EntryState | null {
  if (!value || typeof value !== 'object') return null
  const key: unknown = Reflect.get(value, 'key')
  const index: unknown = Reflect.get(value, 'index')
  const overlay: unknown = Reflect.get(value, 'overlay')
  if (typeof key !== 'string' || typeof index !== 'number') return null
  return { key, index, overlay: typeof overlay === 'string' ? overlay : null }
}

const newKey = () => Math.random().toString(36).slice(2, 10)
const listeners = new Set<() => void>()
const scrollPositions = new Map<string, number>()
const scrollSavers = new Set<() => void>()
let current: AppLocation = { pathname: '/', search: '', hash: '', key: 'initial', index: 0, overlay: null }

function snapshotLocation(): AppLocation {
  const entry = readEntryState(window.history.state)
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    key: entry?.key ?? 'initial',
    index: entry?.index ?? 0,
    overlay: entry?.overlay ?? null,
  }
}

function emit(): void {
  current = snapshotLocation()
  for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') {
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
  const legacy = LEGACY_REDIRECTS.map(([pattern, target]) => {
    const found = window.location.pathname.match(pattern)
    return found ? target(found) : null
  }).find((target): target is string => target !== null)
  const entry = readEntryState(window.history.state)
  window.history.replaceState(
    { key: entry?.key ?? newKey(), index: entry?.index ?? 0, overlay: null } satisfies EntryState,
    '',
    legacy ? `${legacy}${window.location.search}${window.location.hash}` : window.location.href,
  )
  current = snapshotLocation()
  window.addEventListener('popstate', () => {
    saveScroll()
    emit()
  })
}

function saveScroll(): void {
  for (const save of scrollSavers) save()
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const target = new URL(to, window.location.origin)
  const next = `${target.pathname}${target.search}${target.hash}`
  if (next === `${current.pathname}${current.search}${current.hash}` && !current.overlay) return
  saveScroll()
  // Leaving from an open overlay replaces its entry, so back returns to the screen beneath it.
  if (options.replace ?? current.overlay !== null) {
    window.history.replaceState({ key: newKey(), index: current.index, overlay: null } satisfies EntryState, '', next)
  } else {
    window.history.pushState({ key: newKey(), index: current.index + 1, overlay: null } satisfies EntryState, '', next)
  }
  emit()
}

/** Goes back inside the app, or replaces the entry with a sensible parent when the player arrived by deep link. */
export function goBack(fallback = '/'): void {
  if (current.index > 0) window.history.back()
  else navigate(fallback, { replace: true })
}

/** Overlays get their own history entry so the system back gesture closes them. */
export function openOverlay(name: string): void {
  if (current.overlay === name) return
  saveScroll()
  // One overlay at a time: a second overlay takes the first one's entry.
  if (current.overlay) window.history.replaceState({ key: current.key, index: current.index, overlay: name } satisfies EntryState, '', window.location.href)
  else window.history.pushState({ key: current.key, index: current.index + 1, overlay: name } satisfies EntryState, '', window.location.href)
  emit()
}

export function closeOverlay(): void {
  if (!current.overlay) return
  const previous = readEntryState(window.history.state)
  if (previous && previous.index > 0) window.history.back()
  else {
    window.history.replaceState({ key: current.key, index: current.index, overlay: null } satisfies EntryState, '', window.location.href)
    emit()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLocation(): AppLocation {
  return useSyncExternalStore(subscribe, getLocation, getLocation)
}

export function getLocation(): AppLocation {
  return current
}

export function searchParam(location: AppLocation, name: string): string | null {
  return new URLSearchParams(location.search).get(name)
}

/** Props for an anchor that navigates in-app but still works as a real link (open in new tab, copy link). */
export function linkProps(to: string): { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void } {
  return {
    href: to,
    onClick(event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.currentTarget.getAttribute('target')
      if (target && target !== '_self') return
      event.preventDefault()
      navigate(to)
    },
  }
}

/**
 * Keeps a scrolling sheet where the player left it. The entry key is passed in
 * rather than read from the router so an exiting sheet saves under its own entry.
 */
export function useRestoredScroll(ref: RefObject<HTMLElement | null>, entryKey: string): void {
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.scrollTop = scrollPositions.get(entryKey) ?? 0
    const save = () => {
      scrollPositions.set(entryKey, element.scrollTop)
    }
    scrollSavers.add(save)
    return () => {
      scrollSavers.delete(save)
    }
  }, [ref, entryKey])
}
