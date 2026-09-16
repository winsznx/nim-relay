import { useMemo } from 'react'
import { RelayStationScreen } from '../relay-station/RelayStationScreen'
import { toStationView } from '../relay-station/view-model'
import { useNetwork, useNow, useStationProfile } from '../relays/data'
import { navigate } from './router'
import { useSession } from './session'
import { Button } from './ui/Button'
import { EmptyState } from './ui/primitives'

/** The 3D Relay Station, fed from the same network and runner data as the rest of the app. */
export function StationScreen() {
  const { player } = useSession()
  const network = useNetwork()
  const station = useStationProfile()
  const now = useNow(60_000)
  const snapshot = network.snapshot
  const stationData = station.data ?? null
  const playerId = player?.id ?? null
  const data = useMemo(() => (snapshot ? toStationView(snapshot, stationData, playerId, now) : null), [snapshot, stationData, playerId, now])

  return (
    <main className="nr-station">
      {data ? (
        <RelayStationScreen data={data} signedIn={player !== null} onNavigate={route => navigate(route)} />
      ) : (
        <div className="nr-station__waiting">
          {network.failed ? (
            <EmptyState title="The station can’t open yet" body="The relay server isn’t answering. Try again in a moment.">
              <Button variant="secondary" onClick={network.retry}>
                Try again
              </Button>
            </EmptyState>
          ) : (
            <p className="nr-loading" role="status">
              Opening the Relay Station
            </p>
          )}
        </div>
      )}
    </main>
  )
}
