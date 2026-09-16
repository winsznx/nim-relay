import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useReducedMotion } from 'motion/react'
import type { BatonLive } from '@nim-relay/shared'
import { carryingLine, liveFacts, LiveProgressEaser, progressPercent } from './live'

interface LiveLegPanelProps {
  live: BatonLive
  /** The runner whose ghost the holder is racing, when there is one. */
  ghostName: string | null
}

/** The leg the holder is racing right now, as a spectator follows it from the journey. */
export function LiveLegPanel({ live, ghostName }: LiveLegPanelProps) {
  return (
    <section className="nr-live" aria-labelledby="live-leg-title">
      <p className="nr-live__status">
        <span className="nr-live__dot" aria-hidden="true" />
        Live leg
      </p>
      <h3 className="nr-live__title" id="live-leg-title">
        {carryingLine(live)}
      </h3>
      <p className="nr-live__facts">{liveFacts(live, ghostName)}</p>
      <LiveProgress live={live} />
    </section>
  )
}

/** The route bar. It eases between reports and never runs more than the extrapolation limit past the latest one. */
function LiveProgress({ live }: { live: BatonLive }) {
  const bar = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const [easer] = useState(() => new LiveProgressEaser(live.progress, live.updatedAt, performance.now()))
  const [initialStyle] = useState(() => ({ '--nr-live-progress': live.progress }) as CSSProperties)

  useEffect(() => {
    easer.report(live.progress, live.updatedAt, performance.now())
    if (reduced) bar.current?.style.setProperty('--nr-live-progress', String(live.progress))
  }, [easer, reduced, live.progress, live.updatedAt])

  useEffect(() => {
    const element = bar.current
    if (!element || reduced) return
    let frame = 0
    let last = performance.now()
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      element.style.setProperty('--nr-live-progress', easer.frame(now, now - last).toFixed(4))
      last = now
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [easer, reduced])

  return (
    <div
      ref={bar}
      className="nr-live__bar"
      style={initialStyle}
      role="progressbar"
      aria-label={`${live.runnerName}’s leg`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.floor(live.progress * 100)}
      aria-valuetext={`${progressPercent(live.progress)} of the route`}
    >
      <span className="nr-live__fill" />
    </div>
  )
}
