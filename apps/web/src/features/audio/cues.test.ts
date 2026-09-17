import { relayLeg } from '@nim-relay/game-engine'
import { describe, expect, it } from 'vitest'
import { CUES, CueGate, EVENT_CUES, eventCues, planEventCues, voiceFor, type CueName } from './cues'
import { SYNTH_SOUNDS } from './synth'
import { SOUNDS } from './tracks'

const { EVENT } = relayLeg

describe('event mask to cues', () => {
  it('maps every engine event bit to exactly one cue', () => {
    const bits = Object.values(EVENT)
    expect(EVENT_CUES.map(([bit]) => bit).sort((a, b) => a - b)).toEqual([...bits].sort((a, b) => a - b))
    for (const bit of bits) expect(eventCues(bit)).toHaveLength(1)
  })

  it('names the cue each single event plays', () => {
    expect(eventCues(EVENT.PERFECT_GATE)).toEqual(['perfect-gate'])
    expect(eventCues(EVENT.NEAR_MISS)).toEqual(['near-miss'])
    expect(eventCues(EVENT.BOOST_PAD)).toEqual(['boost-pad'])
    expect(eventCues(EVENT.FORK_RISK)).toEqual(['fork-risk'])
    expect(eventCues(EVENT.FLOW_MAX)).toEqual(['flow-max'])
  })

  it('plays every distinct event raised on one tick', () => {
    expect(eventCues(EVENT.JUMP | EVENT.NEAR_MISS | EVENT.BOOST_PAD)).toEqual(['near-miss', 'jump', 'boost-pad'])
    expect(eventCues(EVENT.LAND | EVENT.RAIL_ON)).toEqual(['land', 'rail-on'])
  })

  it('lets the more specific event speak for the one the engine raises with it', () => {
    expect(eventCues(EVENT.PERFECT_GATE | EVENT.PULSE_HIT)).toEqual(['pulse-hit'])
    expect(eventCues(EVENT.LAND | EVENT.CLEAN_LAND)).toEqual(['clean-land'])
    expect(eventCues(EVENT.FALL | EVENT.HIT | EVENT.LAND)).toEqual(['fall'])
  })

  it('ignores an empty mask and bits the engine does not define', () => {
    const undefinedBit = 2 ** 31
    expect(eventCues(0)).toEqual([])
    expect(eventCues(undefinedBit)).toEqual([])
    expect(eventCues(undefinedBit + EVENT.JUMP)).toEqual(['jump'])
  })

  it('gives every v6 moment its own voice', () => {
    expect(eventCues(EVENT.LANE_SHIFT)).toEqual(['lane-shift'])
    expect(eventCues(EVENT.LANE_ACQUIRED)).toEqual(['lane-acquired'])
    expect(eventCues(EVENT.EDGE_GRIND | EVENT.SHOULDER)).toEqual(['edge-grind', 'shoulder'])
    expect(eventCues(EVENT.RUSH_START | EVENT.FLOW_MAX)).toEqual(['rush-start'])
    expect(eventCues(EVENT.GHOST_OVERTAKE | EVENT.DRAFTING)).toEqual(['ghost-overtake', 'drafting'])
  })

  it('lets a failed leg or a tether save speak over the fall around it', () => {
    expect(eventCues(EVENT.LEG_FAILED | EVENT.FALL | EVENT.EDGE_GRIND)).toEqual(['leg-failed'])
    expect(eventCues(EVENT.TETHER_SAVE | EVENT.LAND | EVENT.LANE_ACQUIRED)).toEqual(['tether-save'])
    expect(eventCues(EVENT.EDGE_SAVE | EVENT.LANE_ACQUIRED)).toEqual(['edge-save'])
  })

  it('only uses shipped or synthesized sounds', () => {
    for (const [name, spec] of Object.entries(CUES)) {
      expect(spec.variants.length, name).toBeGreaterThan(0)
      for (const sound of [...spec.variants, ...spec.layers]) {
        const known = Object.hasOwn(SOUNDS, sound) || Object.hasOwn(SYNTH_SOUNDS, sound)
        expect(known, `${name}: ${sound}`).toBe(true)
      }
    }
  })
})

describe('cue rate limiting', () => {
  it('holds a repeated cue until its interval has passed', () => {
    const gate = new CueGate()
    const interval = CUES['perfect-gate'].minInterval
    expect(gate.allow('perfect-gate', 10)).toBe(true)
    expect(gate.allow('perfect-gate', 10 + interval / 2)).toBe(false)
    expect(gate.allow('perfect-gate', 10 + interval)).toBe(true)
  })

  it('limits each cue independently', () => {
    const gate = new CueGate()
    expect(gate.allow('hit', 1)).toBe(true)
    expect(gate.allow('jump', 1)).toBe(true)
    expect(gate.allow('hit', 1.01)).toBe(false)
    expect(gate.allow('ui-tap', 1.01)).toBe(true)
  })

  it('plays an every-tick event once when it starts, and again only after a gap', () => {
    const gate = new CueGate()
    const plays: number[] = []
    const onPad = (from: number, to: number) => {
      for (let tick = from; tick < to; tick++) if (gate.allow('boost-pad', tick / 60)) plays.push(tick)
    }
    onPad(0, 60)
    expect(plays).toEqual([0])
    onPad(80, 120)
    expect(plays).toEqual([0, 80])
  })

  it('applies the gate to a whole event mask', () => {
    const gate = new CueGate()
    expect(planEventCues(EVENT.JUMP | EVENT.PERFECT_GATE, 5, gate)).toEqual(['perfect-gate', 'jump'])
    expect(planEventCues(EVENT.JUMP | EVENT.PERFECT_GATE, 5.01, gate)).toEqual([])
    expect(planEventCues(EVENT.HIT, 5.01, gate)).toEqual(['hit'])
  })

  it('starts fresh after reset', () => {
    const gate = new CueGate()
    const name: CueName = 'finish'
    expect(gate.allow(name, 1)).toBe(true)
    gate.reset()
    expect(gate.allow(name, 1.1)).toBe(true)
  })
})

describe('voices', () => {
  it('picks among variants and spreads the pitch within the cue limits', () => {
    const spec = CUES['near-miss']
    const low = voiceFor(spec, () => 0)
    const high = voiceFor(spec, () => 0.999999)
    expect(low.sound).toBe(spec.variants[0])
    expect(high.sound).toBe(spec.variants.at(-1))
    expect(low.rate).toBeCloseTo(spec.rate * (1 - spec.pitchSpread), 6)
    expect(high.rate).toBeCloseTo(spec.rate * (1 + spec.pitchSpread), 4)
  })

  it('keeps rhythmic cues at a steady pitch', () => {
    expect(voiceFor(CUES['pulse-hit'], () => 0.9).rate).toBe(1)
  })
})
