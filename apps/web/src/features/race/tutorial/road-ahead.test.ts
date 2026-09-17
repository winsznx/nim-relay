import { relayLeg } from '@nim-relay/game-engine'
import { describe, expect, it } from 'vitest'
import { edgeDanger, ghostDraftable, ghostlineAhead, isOwnJump, obstacleAhead, roadClearAhead } from './road-ahead'
import { ONE, laneX, legConfig, stateAt, withGhostline } from './test-states'

const config = legConfig()
const HORIZON = 150

describe('obstacleAhead', () => {
  it('asks for a jump over a barrier across the courier’s line', () => {
    // #given the courier 65 m before the full-width barrier at 205 m
    const state = stateAt(config, 140)
    // #when the road ahead is read
    const ahead = obstacleAhead(state, HORIZON)
    // #then the barrier is a jump, met in 65 m at base speed
    expect(ahead).toEqual({ key: 'hazard:1', answer: 'jump', dist: 205 * ONE, ticks: Math.ceil((65 * ONE) / relayLeg.BASE_SPEED) })
  })

  it('only counts obstacles on the lane the courier steers for', () => {
    // #given the barrier at 150 m blocking the left lane, 50 m ahead
    const inLeftLane = stateAt(config, 100, { targetLane: -2, lane: -2, x: laneX(-2) })
    const shiftingOut = stateAt(config, 100, { targetLane: 0, lane: -2, x: laneX(-2) })
    // #then it blocks the left lane, and a courier already shifting to the centre lane is clear of it
    expect(obstacleAhead(inLeftLane, HORIZON)?.key).toBe('hazard:0')
    expect(obstacleAhead(shiftingOut, HORIZON)).toBeNull()
  })

  it('asks for a slide under an overhead beam', () => {
    // #given the courier in the centre lane 32 m before the beam over the centre and right lanes
    const state = stateAt(config, 640)
    // #then the beam is a slide
    expect(obstacleAhead(state, HORIZON)).toMatchObject({ key: 'hazard:5', answer: 'slide' })
  })

  it('ignores what lies past the horizon, what a stumble carries it through, and a courier off the deck', () => {
    // #given the beam 32 m ahead
    const near = stateAt(config, 640)
    // #then a short horizon, a long stumble or a fall each leave nothing to answer
    expect(obstacleAhead(near, 30)).toBeNull()
    expect(obstacleAhead({ ...near, stumbleTicks: 120 }, HORIZON)).toBeNull()
    expect(obstacleAhead({ ...near, motion: 'falling' }, HORIZON)).toBeNull()
  })

  it('treats an active lane closure as something to steer out of, not jump', () => {
    // #given a closure that shut the left lane long ago, 20 m ahead
    const closureConfig = legConfig({ seed: 'closure-b' })
    const track = relayLeg.buildTrack(closureConfig)
    const closure = track.events.find(event => event.kind === 'lane-closure')!
    const eventTicks = track.events.map(event => (event.id === closure.id ? 0 : -1))
    const lane = closure.lanes[0]!
    const state = stateAt(closureConfig, closure.dist / ONE - 20, { tick: 2000, eventTicks, targetLane: lane, lane, x: laneX(lane) })
    // #then only a lane change answers it
    expect(obstacleAhead(state, HORIZON)).toMatchObject({ key: `event:${closure.id}`, answer: 'dodge' })
  })
})

describe('roadClearAhead', () => {
  it('finds the opening straight calm and the stretch before a barrier not', () => {
    // #then the first metres are clear for two seconds, the approach to the 150 m barrier is not
    expect(roadClearAhead(stateAt(config, 10), 120)).toBe(true)
    expect(roadClearAhead(stateAt(config, 110), 120)).toBe(false)
  })

  it('is never calm in the air or while stumbling', () => {
    expect(roadClearAhead(stateAt(config, 10, { y: ONE, vy: 100 }), 120)).toBe(false)
    expect(roadClearAhead(stateAt(config, 10, { stumbleTicks: 10 }), 120)).toBe(false)
  })
})

describe('Ghostline', () => {
  const ghosted = withGhostline(config)

  it('is ahead only where the ghost rode the courier’s path', () => {
    // #given the lab's ghost, who took the safe path at the first fork
    const fork = relayLeg.buildTrack(config).forks[0]!
    const middle = (fork.from + fork.to) / 2 / ONE
    // #then her line is on the opening straight and her own path, and not on the other path or a leg without a ghost
    expect(ghostlineAhead(stateAt(ghosted, 30))).toBe(true)
    expect(ghostlineAhead(stateAt(ghosted, middle, { path: 'safe' }))).toBe(true)
    expect(ghostlineAhead(stateAt(ghosted, middle, { path: 'risk' }))).toBe(false)
    expect(ghostlineAhead(stateAt(config, 30))).toBe(false)
  })

  it('can be drafted only while the ghost is ahead within drafting reach', () => {
    expect(ghostDraftable(stateAt(ghosted, 30, { ghostLeadTicks: 1 }))).toBe(true)
    expect(ghostDraftable(stateAt(ghosted, 30, { ghostLeadTicks: relayLeg.DRAFT_MAX_LEAD_TICKS }))).toBe(true)
    expect(ghostDraftable(stateAt(ghosted, 30, { ghostLeadTicks: 0 }))).toBe(false)
    expect(ghostDraftable(stateAt(ghosted, 30, { ghostLeadTicks: relayLeg.DRAFT_MAX_LEAD_TICKS + 1 }))).toBe(false)
    expect(ghostDraftable(stateAt(config, 30, { ghostLeadTicks: 30 }))).toBe(false)
  })
})

describe('edgeDanger', () => {
  it('reports the shoulder beyond the outer lane and a rail being ground', () => {
    // #given the three-lane opening, whose outer lanes end 4.5 m from the centre line
    const shoulder = stateAt(config, 60, { x: -(5 * ONE) })
    const grinding = stateAt(config, 60, { motion: 'grinding', edgeSide: 1, x: 6 * ONE })
    // #then each names its side, and a courier inside the lanes is in no danger
    expect(edgeDanger(shoulder)).toEqual({ side: -1, grinding: false, edge: 'rail' })
    expect(edgeDanger(grinding)).toEqual({ side: 1, grinding: true, edge: 'rail' })
    expect(edgeDanger(stateAt(config, 60, { x: laneX(-2) }))).toBeNull()
  })
})

describe('isOwnJump', () => {
  it('tells a jump the courier made from a ramp launching it', () => {
    // #given a grounded courier, and one about to ride off the end of a ramp across every lane
    const rampConfig = legConfig({ world: 'coast', seed: 'b' })
    const ramp = relayLeg.buildTrack(rampConfig).ramps.find(zone => zone.path === 'main')!
    const jumped = relayLeg.step(stateAt(config, 20), { shift: 0, nudge: 0, action: relayLeg.ACTION_JUMP })
    const launched = relayLeg.step(stateAt(rampConfig, (ramp.to - relayLeg.BASE_SPEED / 2) / ONE), { shift: 0, nudge: 0, action: 0 })
    // #then both raise JUMP, but only the courier's own jump counts
    expect(jumped.events & relayLeg.EVENT.JUMP).toBeTruthy()
    expect(launched.events & relayLeg.EVENT.JUMP).toBeTruthy()
    expect(isOwnJump(jumped)).toBe(true)
    expect(isOwnJump(launched)).toBe(false)
  })
})
