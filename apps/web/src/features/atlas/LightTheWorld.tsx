import { useAtlas } from '../relays/data'
import { formatCount } from '../relays/format'
import { lightTheWorld } from './model'
import './atlas.css'

/** Community progress across the Relay Atlas: stations and routes lit by qualified legs. */
export function LightTheWorldMeter() {
  const atlas = useAtlas()
  const light = lightTheWorld(atlas.data)
  const percent = Math.round(light.share * 100)
  return (
    <div className="nr-light" role="group" aria-label="Light the world" data-tour="light-the-world">
      <p className="nr-light__title">Light the world</p>
      <p className="nr-light__count">
        {atlas.data ? (
          <>
            {formatCount(light.stationsLit)}/{formatCount(light.stationsTotal)} stations, {formatCount(light.routesLit)}/{formatCount(light.routesTotal)} routes
          </>
        ) : (
          'Reading the Atlas'
        )}
      </p>
      <div className="nr-light__bar" role="progressbar" aria-label="Stations and routes lit by qualified legs" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
