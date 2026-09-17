import { useEffect } from 'react'
import { atlasRoute, type AtlasRouteStats } from '@nim-relay/shared'
import { playerMessage } from '../shell/errors'
import { linkProps, pathFor } from '../shell/router'
import { Button, LinkButton } from '../shell/ui/Button'
import { EmptyState, Loading, SectionHeader, Stat, StatRow } from '../shell/ui/primitives'
import { Screen } from '../shell/ui/Screen'
import { useAtlasRoute } from '../relays/data'
import { formatCount, formatRaceTime, formatSince, worldName } from '../relays/format'
import { watchPath } from '../relays/paths'
import { useNow } from '../relays/data'
import { playAtlasFlight } from '../world/globe-bridge'
import { heatBand, heatLabel, routeTitle, stationOf, tierName } from './model'
import { RouteLine } from './RouteLine'
import './atlas.css'

/** A compact sheet for one Atlas route: what verified legs did on it and which batons race it now. */
export function AtlasRouteScreen({ entryKey, routeId }: { entryKey: string; routeId: string }) {
  const route = atlasRoute(routeId)
  const query = useAtlasRoute(route ? routeId : null)
  const now = useNow()

  // The globe traces the route once as the sheet opens.
  useEffect(() => {
    if (route) void playAtlasFlight({ from: route.from, to: route.to, kind: 'handoff' })
  }, [route])

  if (!route) {
    return (
      <Screen title="Route" entryKey={entryKey} peek="tall">
        <EmptyState title="No route by that name" body="The Relay Atlas doesn’t have this route. Tap a route on the globe to open one.">
          <LinkButton variant="secondary" to="/">
            Back to the world
          </LinkButton>
        </EmptyState>
      </Screen>
    )
  }

  const from = stationOf(route.from)
  const to = stationOf(route.to)
  const stats = query.data?.stats
  return (
    <Screen title={routeTitle({ origin: route.from, destination: route.to })} kicker="Atlas route" entryKey={entryKey} peek="tall">
      <RouteLine from={from?.name ?? route.from} to={to?.name ?? route.to} world={worldName(route.world)} tier={tierName(route.tier)} heat={heatBand(stats)} />
      {to && <p className="nr-atlas-lede">{to.description}</p>}
      {stats ? (
        <RouteStats stats={stats} now={now} />
      ) : query.isError ? (
        <div className="nr-panel">
          <p>{playerMessage(query.error) ?? 'Route records didn’t load.'}</p>
          <div className="nr-actions">
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <Loading label="Reading verified legs on this route" />
      )}
      <p className="nr-note">Stations are destinations in the game world. They never show where a runner is.</p>
    </Screen>
  )
}

function RouteStats({ stats, now }: { stats: AtlasRouteStats; now: number }) {
  return (
    <>
      <StatRow columns={2} label="Route statistics">
        <Stat value={formatCount(stats.verifiedRuns)} label="verified runs" gold />
        <Stat value={formatCount(stats.qualifiedRunners)} label="qualified runners" />
        <Stat value={formatCount(stats.activeBatons.length)} label="batons on it now" />
        <Stat value={heatLabel(heatBand(stats))} label={stats.lastRunAt ? `last run ${formatSince(stats.lastRunAt, now)}` : 'heat'} />
      </StatRow>

      {!stats.lit && (
        <div className="nr-panel nr-panel--gold">
          <h3>This route is still dark</h3>
          <p>Nobody has raced it yet. The first qualified leg along it lights it for everyone.</p>
        </div>
      )}

      {(stats.fastest || stats.ghostRecord) && (
        <section className="nr-section" aria-labelledby="route-records">
          <SectionHeader id="route-records" title="Records" detail="Only legs raced on this route’s own course count." />
          <ul className="nr-list">
            {stats.fastest && (
              <li className="nr-row">
                <span className="nr-row__body">
                  <span className="nr-row__title">Fastest run</span>
                  <span className="nr-row__meta">
                    <span className="nr-num">{formatRaceTime(stats.fastest.timeMs)}</span> by {stats.fastest.runnerName}, leg {stats.fastest.leg}
                  </span>
                </span>
                <a className="nr-button nr-button--sm nr-button--secondary" {...linkProps(watchPath(stats.fastest.runId, stats.fastest.batonCode))}>
                  Watch
                </a>
              </li>
            )}
            {stats.ghostRecord && (
              <li className="nr-row">
                <span className="nr-row__body">
                  <span className="nr-row__title">Ghost record</span>
                  <span className="nr-row__meta">
                    {stats.ghostRecord.runnerName} beat the ghost in <span className="nr-num">{formatRaceTime(stats.ghostRecord.timeMs)}</span>, ghost{' '}
                    <span className="nr-num">{formatRaceTime(stats.ghostRecord.ghostTimeMs)}</span>
                  </span>
                </span>
                <a className="nr-button nr-button--sm nr-button--secondary" {...linkProps(watchPath(stats.ghostRecord.runId, stats.ghostRecord.batonCode))}>
                  Watch
                </a>
              </li>
            )}
          </ul>
        </section>
      )}

      <section className="nr-section" aria-labelledby="route-batons">
        <SectionHeader id="route-batons" title="Active batons" />
        {stats.activeBatons.length === 0 ? (
          <p className="nr-lede">No baton is racing this route right now.</p>
        ) : (
          <ul className="nr-list">
            {stats.activeBatons.map(baton => (
              <li key={baton.code}>
                <a className="nr-row" {...linkProps(pathFor('relay', { code: baton.code }))}>
                  <span className="nr-row__body">
                    <span className="nr-row__title">{baton.displayName}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
