import { useEffect, useRef, useState } from 'react'
import { networkLabel } from '../relays/format'
import { mountRelayStation, type QualityPreference, type RelayStationHandle } from './scene'
import { SurfaceCard } from './SurfaceCard'
import { STATION_SURFACES, type StationSurfaceId, type StationViewData } from './view-model'
import './relay-station.css'

export interface RelayStationScreenProps {
  data: StationViewData
  onNavigate(route: string): void
  signedIn: boolean
  /** Rendering tier, read once on mount. `auto` (default) picks one per device and sheds load when frames run long. */
  quality?: QualityPreference
}

function neighbour(id: StationSurfaceId, step: 1 | -1): StationSurfaceId {
  const index = STATION_SURFACES.indexOf(id)
  const count = STATION_SURFACES.length
  return STATION_SURFACES[(index + step + count) % count] ?? id
}

/**
 * The player's home between relay legs. The 3D station carries the information;
 * this layer names what is in focus and offers the one action that follows from it.
 */
export function RelayStationScreen({ data, onNavigate, signedIn, quality = 'auto' }: RelayStationScreenProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const stationRef = useRef<RelayStationHandle | null>(null)
  const [selected, setSelected] = useState<StationSurfaceId | null>(null)
  const [sceneFailed, setSceneFailed] = useState(false)

  const initialQuality = useRef(quality)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let station: RelayStationHandle
    try {
      station = mountRelayStation(host, { onSelect: setSelected, quality: initialQuality.current })
    } catch (error) {
      console.error('Relay Station: 3D scene unavailable', error)
      setSceneFailed(true)
      return
    }
    stationRef.current = station
    return () => {
      stationRef.current = null
      station.dispose()
    }
  }, [])

  useEffect(() => {
    stationRef.current?.update(data)
  }, [data])

  useEffect(() => {
    if (selected === null) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      stationRef.current?.focus(null)
      setSelected(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected])

  function select(id: StationSurfaceId | null): void {
    stationRef.current?.focus(id)
    setSelected(id)
  }

  const card = selected ? data.cards[selected] : null

  return (
    <section className="relay-station" data-scene-failed={sceneFailed || undefined} data-focused={selected !== null || undefined} aria-label="Relay Station">
      <div ref={hostRef} className="relay-station-scene" />

      <header className="relay-station-plate">
        <div>
          <h1 className="relay-station-name">Relay Station</h1>
          <p className="relay-station-network">{networkLabel(data.network)}</p>
        </div>
        {!signedIn && selected === null ? (
          <button type="button" className="relay-station-join" onClick={() => onNavigate('/profile')}>
            Set up your courier
          </button>
        ) : null}
      </header>

      <nav className="relay-station-index" aria-label="Station surfaces">
        {sceneFailed ? <p className="relay-station-fallback">The 3D station could not start on this device. Every surface is still here.</p> : null}
        <ul>
          {STATION_SURFACES.map(id => (
            <li key={id}>
              <button type="button" aria-pressed={selected === id} onClick={() => select(selected === id ? null : id)}>
                {data.cards[id].title}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="relay-station-dock" aria-live="polite">
        {selected && card ? (
          <SurfaceCard
            key={selected}
            card={card}
            previousTitle={data.cards[neighbour(selected, -1)].title}
            nextTitle={data.cards[neighbour(selected, 1)].title}
            onAction={onNavigate}
            onPrevious={() => select(neighbour(selected, -1))}
            onNext={() => select(neighbour(selected, 1))}
            onClose={() => select(null)}
          />
        ) : sceneFailed ? null : (
          <p className="relay-station-hint">Tap anything lit to look closer</p>
        )}
      </div>
    </section>
  )
}
