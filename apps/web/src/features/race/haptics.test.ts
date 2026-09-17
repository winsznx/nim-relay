import { relayLeg } from '@nim-relay/game-engine'
import { describe, expect, it } from 'vitest'
import { hapticPattern } from './haptics'

const { EVENT } = relayLeg

describe('race haptics', () => {
  it('lets the strongest moment of a tick decide the buzz', () => {
    // #given ticks that raise several moments at once
    // #then the fall outranks the grind, and the tether save outranks its landing
    expect(hapticPattern(EVENT.FALL | EVENT.EDGE_GRIND, 0)).toEqual([40, 30, 60])
    expect(hapticPattern(EVENT.TETHER_SAVE | EVENT.LAND, 0)).toEqual([12, 40, 12, 40, 70])
    expect(hapticPattern(EVENT.JUMP, 0)).toBeNull()
  })

  it('buzzes a sustained moment when it starts, not on every tick it lasts', () => {
    // #given a shoulder warning raised on consecutive ticks
    const first = hapticPattern(EVENT.SHOULDER, 0)
    const next = hapticPattern(EVENT.SHOULDER, EVENT.SHOULDER)
    // #then only the first tick buzzes, and a lane click on a later tick still does
    expect(first).toEqual([10, 30, 10])
    expect(next).toBeNull()
    expect(hapticPattern(EVENT.SHOULDER | EVENT.LANE_ACQUIRED, EVENT.SHOULDER)).toEqual([5])
  })
})
