import type { NetworkSnapshot, StationSnapshot } from '@nim-relay/shared'
import { stationCards } from './model/cards'
import { createStationContext } from './model/context'
import { departureRows } from './model/departures'
import { chronicleView, courierView, liveView, rankingsView, vaultView, worldView } from './model/displays'
import type { StationViewData } from './model/types'

export { STATION_SURFACES } from './model/types'
export type * from './model/types'

/**
 * Builds everything the Relay Station shows from the network and station snapshots.
 * Pure: the same snapshots and clock always give the same station. Only recorded
 * facts appear; when a snapshot has nothing to show, the view says so plainly.
 */
export function toStationView(network: NetworkSnapshot, station: StationSnapshot | null, playerId: string | null, now: number = Date.now()): StationViewData {
  const context = createStationContext(network, station, playerId, now)
  const world = worldView(context)
  const vault = vaultView(context)
  const courier = courierView(context)
  const chronicle = chronicleView(context)
  const live = liveView(context)
  const rankings = rankingsView(context)
  return {
    network: network.network,
    signedIn: playerId !== null,
    departures: departureRows(context),
    world,
    vault,
    courier,
    chronicle,
    live,
    rankings,
    cards: stationCards(context, { world, vault, courier, chronicle, live, rankings }),
  }
}
