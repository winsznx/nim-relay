import type { AtlasNextRoute, AtlasSnapshot } from '@nim-relay/shared'
import { heatLabel, routeOptions, stationName, type RouteOption } from '../atlas/model'
import { routeNoticeCopy } from './copy'
import { HoloCard, HoloItem, HoloList } from './holo'
import type { RouteNotice } from './machine'

interface RouteStepProps {
  routes: AtlasNextRoute
  atlas: AtlasSnapshot | undefined
  notice: RouteNotice | null
  onChoose(routeId: string | null): void
}

function optionLine(option: RouteOption): string {
  if (option.rerun) return `Same route again. The next runner chases your ghost. ${option.record ?? heatLabel(option.heat)}`
  return `${option.world}, ${option.tier.toLowerCase()}. ${option.record ?? heatLabel(option.heat)}`
}

/** Where the baton goes next: a route out of the station this leg reached, chosen before the runner. */
export function RouteStep({ routes, atlas, notice, onChoose }: RouteStepProps) {
  const options = routeOptions(routes, atlas)
  return (
    <HoloCard className="handoff-route" labelledBy="handoff-route-title">
      <header className="handoff-picker__head">
        <p className="handoff-eyebrow">You reached {stationName(routes.station)}</p>
        <h2 id="handoff-route-title" className="handoff-title handoff-title--picker">
          Where does it go next?
        </h2>
      </header>
      {notice && (
        <p className="handoff-notice" role="alert">
          {routeNoticeCopy(notice)}
        </p>
      )}
      <HoloList className="handoff-routes">
        {options.map(option => (
          <HoloItem key={option.routeId}>
            <button type="button" className="handoff-route-option" data-heat={option.heat} onClick={() => onChoose(option.routeId)}>
              <span className="handoff-route-option__heat" aria-hidden="true" />
              <span className="handoff-route-option__text">
                <span className="handoff-route-option__name">{option.rerun ? `Again to ${option.destination.name}` : option.destination.name}</span>
                <span className="handoff-route-option__meta">{optionLine(option)}</span>
              </span>
              {option.recommended && <span className="handoff-route-option__tag">Relay pick</span>}
            </button>
          </HoloItem>
        ))}
      </HoloList>
      <button type="button" className="handoff-quiet" onClick={() => onChoose(null)}>
        Let the relay choose
      </button>
      <p className="handoff-muted">Stations are places in the game world, not where anyone is.</p>
    </HoloCard>
  )
}

/** The chosen route on the runner step, with a way back to change it. */
export function RouteChip({ routeId, routes, onChange }: { routeId: string | null; routes: AtlasNextRoute; onChange(): void }) {
  const option = routeOptions(routes, undefined).find(candidate => candidate.routeId === routeId)
  return (
    <p className="handoff-route-chip">
      <span>{option ? `Next leg: ${stationName(routes.station)} to ${option.destination.name}` : 'Next leg: the relay picks the route'}</span>
      <button type="button" className="handoff-quiet handoff-quiet--inline" onClick={onChange}>
        Change route
      </button>
    </p>
  )
}
