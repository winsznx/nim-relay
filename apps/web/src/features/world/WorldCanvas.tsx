import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { AtlasSnapshot } from '@nim-relay/shared'
import { useAtlas, useNetwork } from '../relays/data'
import { useLiveBatonIds } from '../relays/live'
import { navigate, pathFor } from '../shell/router'
import type { RelayView } from '../relays/model'
import { mountGlobe, type Framing, type GlobeAtlas, type GlobeHandle, type GlobeRelay } from './globe'
import { attachGlobe, detachGlobe, markGlobeUnavailable, showGlobe } from './globe-bridge'
import './world.css'

export type WorldFraming = 'home' | 'peek' | 'covered'

/** Phones stack the globe above cards and sheets; wide screens set it beside them. */
const FRAMINGS: Record<'narrow' | 'wide', Record<WorldFraming, Framing>> = {
  narrow: {
    home: { centerX: 0.5, centerY: 0.32, fill: 0.96 },
    peek: { centerX: 0.5, centerY: 0.2, fill: 0.7 },
    covered: { centerX: 0.5, centerY: 0.12, fill: 0.62 },
  },
  wide: {
    home: { centerX: 0.64, centerY: 0.46, fill: 0.9 },
    peek: { centerX: 0.38, centerY: 0.47, fill: 0.72 },
    covered: { centerX: 0.38, centerY: 0.47, fill: 0.6 },
  },
}

const WIDE_QUERY = '(min-width: 900px)'

function useWideLayout(): boolean {
  return useSyncExternalStore(
    listener => {
      const query = window.matchMedia(WIDE_QUERY)
      query.addEventListener('change', listener)
      return () => query.removeEventListener('change', listener)
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  )
}

interface WorldCanvasProps {
  relays: readonly RelayView[]
  featuredId: string | null
  selectedId: string | null
  framing: WorldFraming
  /** False while a full-screen experience (race, station) owns the GPU. */
  active: boolean
}

function toGlobeRelay(relay: RelayView, live: boolean): GlobeRelay {
  return { id: relay.id, mode: relay.mode, team: relay.team, crewKey: relay.crewId, status: relay.status, live, hops: relay.hops }
}

function toGlobeAtlas(snapshot: AtlasSnapshot | undefined): GlobeAtlas | null {
  if (!snapshot) return null
  return {
    routes: new Map(snapshot.routes.map(route => [route.routeId, { lit: route.lit, heatLevel: route.heatLevel }])),
    litStations: new Set(snapshot.stations.filter(station => station.lit).map(station => station.stationId)),
  }
}

/** The persistent Earth behind every screen. Mounted once by the app shell. */
export function WorldCanvas({ relays, featuredId, selectedId, framing, active }: WorldCanvasProps) {
  const host = useRef<HTMLDivElement>(null)
  const [globe, setGlobe] = useState<GlobeHandle | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const codes = useRef(new Map<string, string>())
  useEffect(() => {
    codes.current = new Map(relays.map(relay => [relay.id, relay.code]))
  }, [relays])

  useEffect(() => {
    const element = host.current
    if (!element) return
    const handle = mountGlobe(element, {
      onSelect: target => navigate(target.kind === 'relay' ? pathFor('relay', { code: codes.current.get(target.id) ?? target.id }) : pathFor('atlasRoute', { routeId: target.id })),
      onReady: attachGlobe,
      onUnavailable: markGlobeUnavailable,
    })
    if (!handle) {
      markGlobeUnavailable()
      setUnavailable(true)
      return
    }
    showGlobe(handle)
    setGlobe(handle)
    return () => {
      detachGlobe(handle)
      handle.dispose()
      setGlobe(null)
    }
  }, [])

  const { snapshot, receivedAt } = useNetwork()
  const liveIds = useLiveBatonIds(snapshot?.batons, receivedAt)
  const globeRelays = useMemo(() => relays.map(relay => toGlobeRelay(relay, liveIds.has(relay.id))), [relays, liveIds])
  const atlas = useAtlas().data
  const globeAtlas = useMemo(() => toGlobeAtlas(atlas), [atlas])
  useEffect(() => {
    globe?.update({ relays: globeRelays, featuredId, selectedId, atlas: globeAtlas })
  }, [globe, globeRelays, featuredId, selectedId, globeAtlas])

  const layout = useWideLayout() ? 'wide' : 'narrow'
  useEffect(() => {
    globe?.setFraming(FRAMINGS[layout][framing])
    globe?.setBackground(framing === 'covered' && layout === 'narrow')
  }, [globe, framing, layout])

  useEffect(() => {
    globe?.setActive(active)
  }, [globe, active])

  const live = relays.filter(relay => relay.status === 'active').length
  const label =
    live === 0
      ? 'Globe of the Relay Atlas: stations and the routes between them. No batons are moving right now. Tap a route to open it.'
      : `Globe of the Relay Atlas with ${live} active ${live === 1 ? 'baton' : 'batons'} travelling between stations. Drag to turn, pinch to zoom, tap a baton or a route to open it.`
  return (
    <div className="nr-world" data-framing={framing} aria-hidden={!active || undefined}>
      <div ref={host} className="nr-world__globe" role="img" aria-label={label} data-tour="relay-world" />
      <div className="nr-world__vignette" aria-hidden="true" />
      {unavailable && (
        <p className="nr-world__fallback" data-tour="relay-world-fallback">
          This device can’t draw the globe. Every relay is still listed below.
        </p>
      )}
    </div>
  )
}
