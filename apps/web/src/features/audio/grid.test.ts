import { describe, expect, it } from 'vitest'
import {
  BAR_SECONDS,
  BEAT_SECONDS,
  DRIFT_IMMEDIATE_SECONDS,
  DRIFT_STRIKES,
  DRIFT_TOLERANCE_SECONDS,
  RACE_BPM,
  heardTime,
  judgeDrift,
  loopDrift,
  loopPosition,
  planLoopStart,
  raceAnchor,
  tickToSeconds,
} from './grid'

const LOOP = 60 * BAR_SECONDS

describe('race beat grid', () => {
  it('matches the engine pulse: 25 ticks per beat at 60 Hz is 144 BPM', () => {
    expect(RACE_BPM).toBeCloseTo(144, 10)
    expect(tickToSeconds(25)).toBeCloseTo(BEAT_SECONDS, 12)
    expect(tickToSeconds(100)).toBeCloseTo(BAR_SECONDS, 12)
  })

  it('maps every beat tick onto a beat of the loop, wrapping at the loop end', () => {
    for (const beat of [0, 1, 7, 239, 240, 241, 500]) {
      const position = loopPosition(tickToSeconds(beat * 25), LOOP)
      const beatsIntoLoop = position / BEAT_SECONDS
      expect(beatsIntoLoop).toBeCloseTo(beat % 240, 6)
    }
  })

  it('puts negative race time in the loop tail, so a count-in lands on beat 0', () => {
    expect(loopPosition(-BAR_SECONDS, LOOP)).toBeCloseTo(LOOP - BAR_SECONDS, 9)
    expect(loopPosition(LOOP, LOOP)).toBe(0)
  })
})

describe('scheduling against the race clock', () => {
  it('derives the audio time of tick 0 from what is heard now and the tick on screen', () => {
    expect(raceAnchor(50, 600)).toBeCloseTo(40, 9)
    expect(raceAnchor(12.5, -30)).toBeCloseTo(13, 9)
  })

  it('starts mid-race at the position the race has reached', () => {
    const start = planLoopStart(10, 12.03, LOOP)
    expect(start.when).toBe(12.03)
    expect(start.offset).toBeCloseTo(2.03, 9)
  })

  it('starts a count-in in the tail so position 0 plays exactly at the anchor', () => {
    const anchor = 20
    const start = planLoopStart(anchor, 18.5, LOOP)
    expect(start.offset).toBeCloseTo(LOOP - 1.5, 9)
    expect(start.when + (LOOP - start.offset)).toBeCloseTo(anchor, 9)
  })

  it('extrapolates the output timestamp and never runs ahead of the render clock', () => {
    const reading = { currentTime: 5.2, outputLatency: 0.04, stamp: { contextTime: 5.1, performanceTime: 1000 } }
    expect(heardTime(reading, 1050)).toBeCloseTo(5.15, 9)
    expect(heardTime(reading, 1500)).toBe(5.2)
  })

  it('falls back to output latency when there is no usable timestamp', () => {
    expect(heardTime({ currentTime: 3, outputLatency: 0.05, stamp: null }, 0)).toBeCloseTo(2.95, 9)
    expect(heardTime({ currentTime: 3, outputLatency: 0.05, stamp: { contextTime: 0, performanceTime: 0 } }, 10)).toBeCloseTo(2.95, 9)
  })
})

describe('drift', () => {
  it('is positive when the music is ahead of the race and wraps around the loop', () => {
    expect(loopDrift(40, 40.05, LOOP)).toBeCloseTo(0.05, 9)
    expect(loopDrift(40.05, 40, LOOP)).toBeCloseTo(-0.05, 9)
    expect(loopDrift(40, 40 + LOOP + 0.01, LOOP)).toBeCloseTo(0.01, 9)
    expect(loopDrift(40 + LOOP - 0.01, 40, LOOP)).toBeCloseTo(0.01, 9)
  })

  it('ignores drift inside the tolerance and clears strikes', () => {
    expect(judgeDrift(DRIFT_TOLERANCE_SECONDS * 0.9, 2)).toEqual({ resync: false, strikes: 0 })
  })

  it('needs consecutive strikes before correcting a small drift, so one late frame is not drift', () => {
    const drift = DRIFT_TOLERANCE_SECONDS + 0.01
    let strikes = 0
    for (let frame = 1; frame < DRIFT_STRIKES; frame++) {
      const verdict = judgeDrift(drift, strikes)
      expect(verdict.resync).toBe(false)
      strikes = verdict.strikes
    }
    expect(judgeDrift(drift, strikes)).toEqual({ resync: true, strikes: 0 })
  })

  it('forgets strikes when the drift settles back', () => {
    const first = judgeDrift(-0.05, 0)
    const settled = judgeDrift(0.001, first.strikes)
    expect(judgeDrift(-0.05, settled.strikes)).toEqual({ resync: false, strikes: 1 })
  })

  it('corrects a large drift on the first frame', () => {
    expect(judgeDrift(DRIFT_IMMEDIATE_SECONDS, 0)).toEqual({ resync: true, strikes: 0 })
    expect(judgeDrift(-0.4, 0).resync).toBe(true)
  })

  it('detects a simulation that fell behind after a long stall', () => {
    // Music started with tick 0 heard at 10 s. After a stall the race clamps its catch-up,
    // so at heard time 30 s the screen shows 250 ms less race than the audio played.
    const playingAnchor = 10
    const anchorNow = raceAnchor(30, (20 - 0.25) * 60)
    const drift = loopDrift(playingAnchor, anchorNow, LOOP)
    expect(drift).toBeCloseTo(0.25, 6)
    expect(judgeDrift(drift, 0).resync).toBe(true)
  })
})
