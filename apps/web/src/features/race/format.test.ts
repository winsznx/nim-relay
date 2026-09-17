import type { relayLeg } from '@nim-relay/game-engine'
import { describe, expect, it } from 'vitest'
import { deltaChip, flowControlPercent, formatSeconds, ghostGap, possessive, routeReadout, verdict } from './format'

const metrics: relayLeg.Metrics = {
  perfectGates: 0, totalGates: 0, pulseHits: 0, nearMisses: 0, hits: 0, falls: 0, jumps: 0, cleanLandings: 0, hardLandings: 0,
  slides: 0, railTicks: 0, boostPadTicks: 0, riskRoutes: 0, laneChanges: 0, cleanLaneChanges: 0, edgeGrinds: 0, edgeSaves: 0,
  tetherSaves: 0, draftTicks: 0, overtakes: 0, rushes: 0, rushTicks: 0, flowSum: 0, flowPeak: 0,
}

describe('race copy', () => {
  it('shows the ghost ahead, or the courier ahead, with the gap in seconds', () => {
    // #given the ghost ahead by 0.31 s and then behind by 0.17 s
    // #when the chip copy is built
    const chasing = deltaChip('Mariana', 0.312)
    const leading = deltaChip('Mariana', -0.171)
    // #then the leader's name carries the gap
    expect(chasing).toEqual({ label: 'MARIANA', value: '+0.31', leader: 'ghost' })
    expect(leading).toEqual({ label: 'YOU', value: '+0.17', leader: 'you' })
  })

  it('names the ghost while the race is level', () => {
    // #given no gap at the start line
    // #then the chip reads as the ghost to chase
    expect(deltaChip('Tim', 0).label).toBe('TIM')
  })

  it('writes the gap as a split: minus while the courier leads', () => {
    // #given the courier ahead, behind and level
    // #then the split reads like a stopwatch
    expect(ghostGap(-0.181)).toBe('−0.18s')
    expect(ghostGap(0.314)).toBe('+0.31s')
    expect(ghostGap(0.001)).toBe('0.00s')
  })

  it('reads route progress with the split under the relay bar', () => {
    // #given 62.7% of the leg run, with and without a ghost
    // #then progress rounds down and the split follows it
    expect(routeReadout(0.627, -0.18)).toBe('62% · −0.18s')
    expect(routeReadout(0.627, null)).toBe('62%')
    expect(routeReadout(1.2, null)).toBe('100%')
  })

  it('reports who beat whom by how much', () => {
    // #given run and ghost times in milliseconds
    // #then the verdict is written from the courier's point of view
    expect(verdict('Mariana', 42_190, 41_820)).toBe('YOU BEAT MARIANA BY 0.37s')
    expect(verdict('Mariana', 41_640, 41_820)).toBe('MARIANA BEAT YOU BY 0.18s')
    expect(verdict('Tim', 41_820, 41_820)).toBe('DEAD HEAT WITH TIM')
  })

  it('writes possessives and times the way the HUD shows them', () => {
    // #given names with and without a trailing s
    // #then possessives and times read naturally
    expect(possessive('Tim')).toBe('TIM’S')
    expect(possessive('Marcus')).toBe('MARCUS’')
    expect(formatSeconds(41_820)).toBe('41.82s')
  })

  it('turns summed FLOW into a control percentage', () => {
    // #given half FLOW held for every tick of a 100-tick leg
    // #when it is summarised
    const percent = flowControlPercent({ ...metrics, flowSum: 100 * 32768 }, 100)
    // #then it reads 50%, and an empty leg reads 0%
    expect(percent).toBe(50)
    expect(flowControlPercent(metrics, 0)).toBe(0)
  })
})
