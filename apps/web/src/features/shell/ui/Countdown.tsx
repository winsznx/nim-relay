import { useEffect, useEffectEvent, useState } from 'react'
import { formatClock } from '../../relays/format'
import './game.css'

interface CountdownProps {
  /** Epoch milliseconds the countdown reaches zero at. */
  to: number
  /** Runs once when the countdown reaches zero while on screen. */
  onElapsed?: () => void
  className?: string
}

/**
 * A ticking HH:MM:SS clock. It owns its one-second timer, so only this text
 * re-renders while it runs, and the timer stops at zero.
 */
export function Countdown({ to, onElapsed, className }: CountdownProps) {
  const [now, setNow] = useState(Date.now)
  const done = now >= to
  const elapse = useEffectEvent(() => onElapsed?.())

  useEffect(() => {
    if (done) return
    let interval = 0
    const tick = () => {
      const current = Date.now()
      setNow(current)
      if (current >= to) {
        window.clearInterval(interval)
        elapse()
      }
    }
    // Ticks land on whole seconds, so every countdown on screen changes together.
    const timeout = window.setTimeout(() => {
      tick()
      interval = window.setInterval(tick, 1000)
    }, 1000 - (Date.now() % 1000))
    return () => {
      window.clearTimeout(timeout)
      window.clearInterval(interval)
    }
  }, [done, to])

  return (
    <time role="timer" className={['nr-countdown', 'nr-num', className].filter(Boolean).join(' ')} dateTime={new Date(to).toISOString()}>
      {formatClock(to - now)}
    </time>
  )
}
