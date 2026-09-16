import { useMemo, useState, type CSSProperties } from 'react'
import { RelayStationScreen } from '../RelayStationScreen'
import type { QualityPreference } from '../scene'
import { toStationView } from '../view-model'
import { busyScenario, emptyScenario, signedOutScenario } from './fixtures'

/**
 * Development lab for the Relay Station on fixture data. Query parameters:
 * `fixture=busy|signed-out|empty` picks a scenario, `quality=high|medium|low` fixes the
 * rendering tier, `chrome=0` hides the lab controls.
 */

const SCENARIOS = {
  busy: busyScenario,
  'signed-out': signedOutScenario,
  empty: emptyScenario,
} as const

type ScenarioName = keyof typeof SCENARIOS

function isScenario(value: string | null): value is ScenarioName {
  return value !== null && value in SCENARIOS
}

function initialQuality(): QualityPreference {
  const requested = new URLSearchParams(window.location.search).get('quality')
  return requested === 'high' || requested === 'medium' || requested === 'low' ? requested : 'auto'
}

function initialScenario(): ScenarioName {
  const requested = new URLSearchParams(window.location.search).get('fixture')
  return isScenario(requested) ? requested : 'busy'
}

export function StationLab() {
  const [scenario, setScenario] = useState<ScenarioName>(initialScenario)
  const [lastRoute, setLastRoute] = useState<string | null>(null)
  const [quality] = useState(initialQuality)
  const showChrome = new URLSearchParams(window.location.search).get('chrome') !== '0'
  const fixture = useMemo(() => SCENARIOS[scenario](), [scenario])
  const data = useMemo(() => toStationView(fixture.network, fixture.station, fixture.playerId, fixture.now), [fixture])

  function chooseScenario(next: ScenarioName): void {
    setScenario(next)
    setLastRoute(null)
    const url = new URL(window.location.href)
    url.searchParams.set('fixture', next)
    window.history.replaceState(null, '', url)
  }

  return (
    <div data-station-lab data-last-route={lastRoute ?? undefined} style={styles.frame}>
      <RelayStationScreen data={data} signedIn={fixture.playerId !== null} onNavigate={setLastRoute} quality={quality} />
      {showChrome ? (
        <div style={styles.controls}>
          <label style={styles.label}>
            Fixture
            <select value={scenario} onChange={event => isScenario(event.target.value) && chooseScenario(event.target.value)} style={styles.select}>
              {Object.keys(SCENARIOS).map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {lastRoute ? <output style={styles.route}>onNavigate {lastRoute}</output> : null}
        </div>
      ) : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  frame: { position: 'fixed', inset: 0 },
  controls: {
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top, 0px) + 72px)',
    left: 16,
    zIndex: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    font: '12px/1.2 ui-sans-serif, system-ui',
    color: '#9aa3b8',
  },
  label: { display: 'flex', alignItems: 'center', gap: 6 },
  select: { background: '#0e1425', color: '#f5f7fa', border: '1px solid #283048', borderRadius: 6, padding: '2px 4px' },
  route: { color: '#f5a623' },
}
