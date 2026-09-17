import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { LaunchParameters } from './machine'

const FULL_CHARGE_MS = 1100

interface Charge {
  pointerId: number
  startedAt: number
  startY: number
  y: number
}

/** Hold to charge, drag up to raise the arc, release to throw. */
export function LaunchPad({ onThrow }: { onThrow(launch: LaunchParameters): void }) {
  const charge = useRef<Charge | null>(null)
  const [level, setLevel] = useState(0)
  const charging = level > 0

  // The charge follows the frame clock while the pad is held.
  useEffect(() => {
    if (!charging) return
    let frame = 0
    const tick = () => {
      const active = charge.current
      if (!active) return
      setLevel(Math.min(1, (performance.now() - active.startedAt) / FULL_CHARGE_MS) || 0.001)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [charging])

  const release = () => {
    const active = charge.current
    if (!active) return
    charge.current = null
    setLevel(0)
    const held = Math.min(1, (performance.now() - active.startedAt) / FULL_CHARGE_MS)
    const power = Math.round(30 + held * 70)
    const angle = Math.max(15, Math.min(75, Math.round(45 + (active.startY - active.y) / 4)))
    if ('vibrate' in navigator) navigator.vibrate(24)
    onThrow({ angle, power })
  }

  return (
    <div className="handoff-launchpad" data-charging={charging ? 'true' : 'false'}>
      <button
        type="button"
        className="handoff-pad"
        style={{ '--charge': level } as CSSProperties}
        aria-label="Hold to charge the throw, release to pass the baton"
        onPointerDown={event => {
          event.currentTarget.setPointerCapture(event.pointerId)
          charge.current = { pointerId: event.pointerId, startedAt: performance.now(), startY: event.clientY, y: event.clientY }
          setLevel(0.001)
        }}
        onPointerMove={event => {
          if (charge.current?.pointerId === event.pointerId) charge.current.y = event.clientY
        }}
        onPointerUp={release}
        onPointerCancel={() => {
          charge.current = null
          setLevel(0)
        }}
        onKeyDown={event => {
          if ((event.key === ' ' || event.key === 'Enter') && !charge.current && !event.repeat) {
            event.preventDefault()
            charge.current = { pointerId: -1, startedAt: performance.now(), startY: 0, y: 0 }
            setLevel(0.001)
          }
        }}
        onKeyUp={event => {
          if (event.key === ' ' || event.key === 'Enter') release()
        }}
      >
        <span className="handoff-pad__halo" aria-hidden="true" />
        <span className="handoff-pad__ring" aria-hidden="true" />
        <span className="handoff-pad__core" aria-hidden="true" />
      </button>
      <p className="handoff-hint">{charging ? 'Release to throw' : 'Hold the baton. Release to throw.'}</p>
    </div>
  )
}
