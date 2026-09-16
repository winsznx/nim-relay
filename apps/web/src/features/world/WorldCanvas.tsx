import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { navigate, pathFor } from '../shell/router'
import type { RelayView } from '../relays/model'
import { mountGlobe, type Framing, type GlobeHandle, type GlobeRelay } from './globe'
import { attachGlobe, detachGlobe, markGlobeUnavailable } from './globe-bridge'
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

function toGlobeRelay(relay: RelayView): GlobeRelay {
  return { id: relay.id, mode: relay.mode, team: relay.team, crewKey: relay.crewId, status: relay.status, stops: relay.stops.map(stop => stop.countryCode) }
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
      onSelect: relayId => navigate(pathFor('relay', { code: codes.current.get(relayId) ?? relayId })),
      onReady: attachGlobe,
      onUnavailable: markGlobeUnavailable,
    })
    if (!handle) {
      markGlobeUnavailable()
      setUnavailable(true)
      return
    }
    setGlobe(handle)
    return () => {
      detachGlobe(handle)
      handle.dispose()
      setGlobe(null)
    }
  }, [])

  const globeRelays = useMemo(() => relays.map(toGlobeRelay), [relays])
  useEffect(() => {
    globe?.update({ relays: globeRelays, featuredId, selectedId })
  }, [globe, globeRelays, featuredId, selectedId])

  const layout = useWideLayout() ? 'wide' : 'narrow'
  useEffect(() => {
    globe?.setFraming(FRAMINGS[layout][framing])
    globe?.setBackground(framing === 'covered' && layout === 'narrow')
  }, [globe, framing, layout])

  useEffect(() => {
    globe?.setActive(active)
  }, [globe, active])

  const live = relays.filter(relay => relay.status === 'active').length
  const label = live === 0 ? 'Globe of the relay network. No batons are moving right now.' : `Globe of the relay network with ${live} active ${live === 1 ? 'baton' : 'batons'}. Drag to turn, pinch to zoom, tap a route to open it.`
  return (
    <div className="nr-world" data-framing={framing} aria-hidden={!active || undefined}>
      <div ref={host} className="nr-world__globe" role="img" aria-label={label} />
      <div className="nr-world__vignette" aria-hidden="true" />
      {unavailable && <p className="nr-world__fallback">This device can’t draw the globe. Every relay is still listed below.</p>}
    </div>
  )
}
