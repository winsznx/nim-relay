import { LIVE_BROADCAST_INTERVAL_MS } from './constants'

/**
 * Turns live leg changes into broadcasts, at most one every LIVE_BROADCAST_INTERVAL_MS across all batons. A change
 * inside the window is sent when the window closes, so the latest progress still goes out while the object is awake.
 */
export class LiveUpdates {
  private sentAt = Number.NEGATIVE_INFINITY
  private pending: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly send: () => void) {}

  changed(now: number): void {
    if (this.pending !== null) return
    const wait = this.sentAt + LIVE_BROADCAST_INTERVAL_MS - now
    if (wait <= 0) {
      this.flush(now)
      return
    }
    this.pending = setTimeout(() => {
      this.pending = null
      this.flush(Date.now())
    }, wait)
  }

  private flush(now: number): void {
    this.sentAt = now
    this.send()
  }
}
