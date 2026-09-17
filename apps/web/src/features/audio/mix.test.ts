import { describe, expect, it } from 'vitest'
import { FLOW_HIGH, FLOW_MID } from '../race/flow-tier'
import { FLOW_RISE_HYSTERESIS, FlowRise, LOWPASS_CLOSED_HZ, LOWPASS_OPEN_HZ, flowMix, speedMix } from './mix'

const steps = Array.from({ length: 101 }, (_, i) => i / 100)

describe('FLOW mix', () => {
  it('hears the track through a filter at low FLOW and opens it fully by mid FLOW', () => {
    expect(flowMix(0).lowpassHz).toBeCloseTo(LOWPASS_CLOSED_HZ, 6)
    expect(flowMix(0.25).lowpassHz).toBeGreaterThan(2000)
    expect(flowMix(0.25).lowpassHz).toBeLessThan(6000)
    expect(flowMix(0.5).lowpassHz).toBe(LOWPASS_OPEN_HZ)
    const cutoffs = steps.map(flow => flowMix(flow).lowpassHz)
    cutoffs.slice(1).forEach((cutoff, i) => expect(cutoff).toBeGreaterThanOrEqual(cutoffs[i] ?? 0))
  })

  it('adds the hat layer, brightness and width only near full FLOW', () => {
    expect(flowMix(0.6)).toMatchObject({ hatGain: 0, brightnessDb: 0, width: 1 })
    expect(flowMix(1)).toMatchObject({ hatGain: 1, brightnessDb: 3 })
    expect(flowMix(1).width).toBeCloseTo(1.3, 9)
  })

  it('exposes the rider to more wind while FLOW is low', () => {
    expect(flowMix(0).windBoost).toBeGreaterThan(flowMix(0.3).windBoost)
    expect(flowMix(0.5).windBoost).toBe(0)
  })

  it('goes past full FLOW through Relay Rush', () => {
    const full = flowMix(1)
    const rush = flowMix(1, true)
    expect(rush.brightnessDb).toBeGreaterThan(full.brightnessDb)
    expect(rush.width).toBeGreaterThan(full.width)
    expect(rush.hatGain).toBe(1)
    expect(rush.windBoost).toBeGreaterThan(full.windBoost)
  })

  it('treats out-of-range and invalid input as the nearest valid FLOW', () => {
    expect(flowMix(-2)).toEqual(flowMix(0))
    expect(flowMix(7)).toEqual(flowMix(1))
    expect(flowMix(Number.NaN)).toEqual(flowMix(0))
  })
})

describe('speed mix', () => {
  it('raises wind and hum level and pitch with speed', () => {
    const slow = speedMix(0)
    const fast = speedMix(1)
    expect(fast.windGain).toBeGreaterThan(slow.windGain)
    expect(fast.windRate).toBeGreaterThan(slow.windRate)
    expect(fast.hoverRate).toBeGreaterThan(slow.hoverRate)
    expect(fast.hoverGain).toBeGreaterThan(slow.hoverGain)
  })
})

describe('FLOW rise', () => {
  it('announces each climb into the mid and high tiers once', () => {
    // #given a race starting at its opening FLOW
    const rise = new FlowRise()
    const heard = [0.2, 0.4, FLOW_MID, 0.6, FLOW_HIGH, 0.9, 1].map(flow => rise.update(flow))
    // #then only the two tier crossings sound
    expect(heard).toEqual([false, false, true, false, true, false, false])
  })

  it('stays quiet while FLOW rides a tier boundary', () => {
    // #given FLOW that reached mid and wobbles just under it
    const rise = new FlowRise()
    rise.update(0)
    rise.update(FLOW_MID)
    const wobble = [FLOW_MID - FLOW_RISE_HYSTERESIS / 2, FLOW_MID, FLOW_MID - 0.01, FLOW_MID + 0.01].map(flow => rise.update(flow))
    // #then nothing sounds again until FLOW really drops and climbs back
    expect(wobble).toEqual([false, false, false, false])
    rise.update(FLOW_MID - FLOW_RISE_HYSTERESIS - 0.01)
    expect(rise.update(FLOW_MID)).toBe(true)
  })

  it('takes the first reading of a race as its starting tier', () => {
    // #given a detector reset for a new race
    const rise = new FlowRise()
    rise.update(0.9)
    rise.reset()
    // #when the new race starts high, then climbs
    const first = rise.update(FLOW_HIGH + 0.05)
    // #then the start is silent
    expect(first).toBe(false)
  })
})
