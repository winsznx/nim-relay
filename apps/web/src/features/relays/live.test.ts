import { describe, expect, it } from 'vitest'
import { LIVE_LEG_WINDOW_MS, type BatonLive } from '@nim-relay/shared'
import { carryingLine, isLiveUpdate, LIVE_EXTRAPOLATION_LIMIT, liveFacts, liveNumbers, LiveProgressEaser, liveStaleAt, progressPercent } from './live'

const live: BatonLive = { runnerName: 'Tim', runnerHandle: 'tim', progress: 0.6249, ghostDeltaMs: 310, world: 'metro', sector: 2, updatedAt: 50_000, ageMs: 1_200 }

/** Runs 60 fps frames from `from` to `to` and returns the last value. */
function playFrames(easer: LiveProgressEaser, from: number, to: number): number {
  let value = 0
  for (let now = from; now <= to; now += 16) value = easer.frame(now, 16)
  return value
}

describe('live leg copy', () => {
  it('says who carries the baton, how far, against whom and where', () => {
    expect([carryingLine(live), liveFacts(live, 'Mariana')]).toEqual(['TIM IS CARRYING THE BATON NOW', '62% · +0.31s vs MARIANA · Midnight Metro'])
  })

  it('shows a lead over the ghost with a minus sign, and leaves the gap out without a ghost', () => {
    expect([liveFacts({ ...live, ghostDeltaMs: -1_046 }, 'Mariana'), liveFacts({ ...live, ghostDeltaMs: null }, null)]).toEqual(['62% · −1.05s vs MARIANA · Midnight Metro', '62% · Midnight Metro'])
  })

  it('keeps the numbers short for the world home, with the gap only when there is a ghost', () => {
    expect([liveNumbers(live), liveNumbers({ ...live, ghostDeltaMs: null })]).toEqual(['62% · +0.31s', '62%'])
  })

  it('rounds progress down, so a leg never reads further along than reported', () => {
    expect([progressPercent(0.999), progressPercent(1), progressPercent(-0.2)]).toEqual(['99%', '100%', '0%'])
  })
})

describe('relay room broadcasts', () => {
  it('tell live progress apart from other network changes', () => {
    const messages = [JSON.stringify({ type: 'network_updated', live: true }), JSON.stringify({ type: 'network_updated', version: 42 }), 'not json', null]
    expect(messages.map(isLiveUpdate)).toEqual([true, false, false, false])
  })
})

describe('live window', () => {
  it('ends the report’s eight seconds on this client’s clock, counting the age it arrived with', () => {
    // #given a report 1.2 s old when its response arrived at local time 900_000
    // #then it stops counting 6.8 s after arrival
    expect(liveStaleAt(live, 900_000)).toBe(900_000 + LIVE_LEG_WINDOW_MS - 1_200)
  })
})

describe('LiveProgressEaser', () => {
  it('eases onward at the reported pace but never past the latest report plus the limit', () => {
    // #given two reports two seconds apart, gaining 4% of the route
    const easer = new LiveProgressEaser(0.5, 10_000, 0)
    easer.report(0.54, 12_000, 2_000)
    // #when ten seconds pass without another report
    const shown = playFrames(easer, 2_000, 12_000)
    // #then the bar stops exactly at the ceiling
    expect(shown).toBeCloseTo(0.54 + LIVE_EXTRAPOLATION_LIMIT, 6)
  })

  it('reaches a new report smoothly instead of jumping', () => {
    // #given a bar resting at 50% and a report of 60% a minute later
    const easer = new LiveProgressEaser(0.5, 10_000, 0)
    playFrames(easer, 0, 1_000)
    easer.report(0.6, 70_000, 1_000)
    // #when one frame and then two seconds pass
    const firstFrame = easer.frame(1_016, 16)
    const settled = playFrames(easer, 1_032, 3_000)
    // #then the first step is small and the bar has reached the report without passing its ceiling
    expect({ smallFirstStep: firstFrame < 0.505, reached: settled >= 0.599 && settled <= 0.6 + LIVE_EXTRAPOLATION_LIMIT }).toEqual({ smallFirstStep: true, reached: true })
  })

  it('drops at once to a report that shows less progress, as when the leg starts again', () => {
    // #given a bar well along the route
    const easer = new LiveProgressEaser(0.8, 10_000, 0)
    playFrames(easer, 0, 500)
    // #when the next report is near the start
    easer.report(0.05, 12_000, 600)
    // #then the very next frame is within the limit of it
    expect(easer.frame(616, 16)).toBeLessThanOrEqual(0.05 + LIVE_EXTRAPOLATION_LIMIT)
  })
})
