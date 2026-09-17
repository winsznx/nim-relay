import type { HeatBand } from './model'
import { heatLabel } from './model'

interface RouteLineProps {
  from: string
  to: string
  world: string
  tier: string
  heat: HeatBand
}

/** Two stations joined by an arc that glows with the route's verified heat. */
export function RouteLine({ from, to, world, tier, heat }: RouteLineProps) {
  return (
    <div className="nr-routeline" data-heat={heat}>
      <svg className="nr-routeline__arc" viewBox="0 0 300 64" preserveAspectRatio="none" aria-hidden="true">
        <path d="M8 56 C 90 -8, 210 -8, 292 56" />
        <circle cx="8" cy="56" r="5" />
        <circle cx="292" cy="56" r="5" />
      </svg>
      <div className="nr-routeline__ends">
        <span>{from}</span>
        <span>{to}</span>
      </div>
      <p className="nr-routeline__meta">
        {world}, {tier.toLowerCase()}. {heatLabel(heat)}.
      </p>
    </div>
  )
}
