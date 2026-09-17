import type { AtlasProfile as AtlasProgress } from '@nim-relay/shared'
import { SectionHeader, Stat, StatRow } from '../shell/ui/primitives'
import { formatCount, formatDateTime } from '../relays/format'
import { stationName } from './model'
import './atlas.css'

/** A runner's progress across the Relay Atlas and their Atlas missions, all counted from qualified legs. */
export function AtlasProfileSection({ atlas }: { atlas: AtlasProgress }) {
  const completed = atlas.missions.filter(mission => mission.completedAt !== null).length
  return (
    <section className="nr-section" aria-labelledby="profile-atlas" data-tour="profile-atlas">
      <SectionHeader id="profile-atlas" title="Relay Atlas" detail="Stations and routes your qualified legs reached. Stations are game-world destinations." />
      <StatRow columns={2} label="Atlas progress">
        <Stat value={formatCount(atlas.stationsVisited)} label="stations visited" gold />
        <Stat value={formatCount(atlas.routesCompleted)} label="routes completed" />
        <Stat value={formatCount(atlas.routesDiscovered)} label="routes discovered" />
        <Stat value={formatCount(atlas.journeys)} label="baton journeys" />
      </StatRow>
      {atlas.stations.length > 0 && <p className="nr-atlas-lede">Visited {atlas.stations.map(stationName).join(', ')}.</p>}
      <h3 className="nr-visually-hidden">Missions</h3>
      <p className="nr-note">
        {formatCount(completed)} of {formatCount(atlas.missions.length)} missions complete. Rewards are profile marks, never NIM.
      </p>
      <ul className="nr-missions">
        {atlas.missions.map(mission => {
          const done = mission.completedAt !== null
          return (
            <li key={mission.id} className="nr-mission" data-done={done}>
              <p className="nr-mission__title">{mission.title}</p>
              <p className="nr-mission__progress">
                {done ? 'Complete' : `${formatCount(mission.progress)}/${formatCount(mission.target)}`}
                {!done && <span className="nr-visually-hidden">, locked</span>}
              </p>
              <p className="nr-mission__meta">
                {mission.description}. {done && mission.completedAt !== null ? `${mission.reward}, earned ${formatDateTime(mission.completedAt)}.` : `Unlocks ${mission.reward.toLowerCase()}.`}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
