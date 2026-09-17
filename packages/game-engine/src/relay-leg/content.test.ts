import { describe, expect, it } from 'vitest'
import { ONE } from '../fixed-point'
import { BASE_SPEED, GUST_OFFSET_TICKS, LANE_WIDTH, STUMBLE_SPEED } from './constants'
import {
  COLLISION,
  eventBodyCount,
  eventClearance,
  eventCollision,
  gatingEventFor,
  hazardClearance,
  isGatingEvent,
} from './dynamics'
import {
  forkAt,
  isLaneSlot,
  laneCenterX,
  laneEdgeOf,
  laneLayoutAt,
  laneSlots,
  mainLanesAtFork,
  type LaneLayout,
} from './geometry'
import { WORLD_KITS, worldTemplates, type FeatureTemplate, type HazardTemplate } from './modules'
import { createState, step } from './sim'
import { PULSE_PERIOD, ROUTE_MAX_METRES, ROUTE_MIN_METRES, TIER0_PROTECTED_METRES, buildTrack, pathsTouch } from './track'
import { EVENT, MAX_TICKS, WORLDS, type Config, type Hazard, type HazardKind, type Path, type State, type Tier, type Track, type World, type WorldEvent, type WorldEventKind, type Zone } from './types'
import { millimetres } from './units'

const SEEDS = 500
const TIERS: readonly Tier[] = [0, 1, 2]
const M = ONE

interface Built {
  world: World
  tier: Tier
  seed: string
  track: Track
}

const routes: Built[] = []
for (const world of WORLDS) {
  for (const tier of TIERS) {
    for (let i = 0; i < SEEDS; i++) {
      const seed = `content-${i}`
      routes.push({ world, tier, seed, track: buildTrack({ seed, world, tier }) })
    }
  }
}

/** Collects every violation so a failure names the route instead of stopping at the first assert. */
function violations(check: (route: Built) => string | null): string[] {
  const found: string[] = []
  for (const route of routes) {
    const problem = check(route)
    if (problem) found.push(`${route.world} t${route.tier} ${route.seed}: ${problem}`)
  }
  return found.slice(0, 10)
}

const metres = (value: number): string => (value / M).toFixed(1)
const isCollidable = (hazard: Hazard): boolean => hazard.kind !== 'gust'

/** Lane slots whose centre is clear of a blocked area. */
function freeLanes(layout: LaneLayout, clearanceAt: (x: number) => number): number[] {
  return laneSlots(layout.count).filter(slot => clearanceAt(laneCenterX(slot, layout.width)) >= 0)
}

const COLLIDING_EVENTS: readonly WorldEventKind[] = ['lane-closure', 'maintenance-drone', 'transit-crossing', 'collapsing-gantry', 'drone-pattern']
const collides = (event: WorldEvent): boolean => COLLIDING_EVENTS.includes(event.kind)

describe('relay leg route shape', () => {
  it(`keeps every route between ${ROUTE_MIN_METRES} and ${ROUTE_MAX_METRES} m, finishable at base speed`, () => {
    const found = violations(({ track }) => {
      if (track.finishDist < ROUTE_MIN_METRES * M || track.finishDist > ROUTE_MAX_METRES * M) return `length ${metres(track.finishDist)} m`
      return track.finishDist / BASE_SPEED < MAX_TICKS * 3 / 4 ? null : 'too long to finish at base speed'
    })
    expect(found).toEqual([])
  })

  it('lays segments contiguously with continuous ground, standard lanes and three-lane main road', () => {
    const found = violations(({ track }) => {
      const segments = track.segments
      if (segments[0]?.from !== 0 || segments.at(-1)?.to !== track.finishDist) return 'segments do not span the route'
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]!
        if (segment.index !== i || segment.to <= segment.from) return `segment ${i} is malformed`
        if (segment.laneWidth !== LANE_WIDTH || segment.shoulder <= 0) return `segment ${i} lane geometry`
        if (!forkAt(track, segment.from) && segment.laneCount !== 3) return `main segment ${i} has ${segment.laneCount} lanes`
        const next = segments[i + 1]
        if (next && (next.from !== segment.to || next.elevationFrom !== segment.elevationTo)) return `seam after segment ${i}`
      }
      return null
    })
    expect(found).toEqual([])
  })

  it('sorts every feature list by distance', () => {
    const sorted = (values: readonly number[]): boolean => values.every((value, i) => i === 0 || values[i - 1]! <= value)
    const found = violations(({ track }) => {
      const lists: Record<string, readonly number[]> = {
        gates: track.gates.map(gate => gate.dist),
        hazards: track.hazards.map(hazard => hazard.dist),
        events: track.events.map(event => event.dist),
        ramps: track.ramps.map(zone => zone.from),
        gaps: track.gaps.map(zone => zone.from),
        rails: track.rails.map(zone => zone.from),
        boostPads: track.boostPads.map(zone => zone.from),
        setPieces: track.setPieces.map(piece => piece.dist),
        checkpoints: track.checkpoints.map(checkpoint => checkpoint.dist),
      }
      const unsorted = Object.entries(lists).find(([, values]) => !sorted(values))
      if (unsorted) return `${unsorted[0]} unsorted`
      return track.events.every((event, id) => event.id === id) ? null : 'event ids are not their route order'
    })
    expect(found).toEqual([])
  })

  it('builds identical tracks for identical configs and different tracks for different seeds', () => {
    const config = { seed: 'determinism', world: 'metro', tier: 1 } as const
    expect(buildTrack(config)).toEqual(buildTrack(config))
    expect(JSON.stringify(buildTrack({ ...config, seed: 'determinism-2' }))).not.toBe(JSON.stringify(buildTrack(config)))
  })
})

describe('relay leg forks', () => {
  it('splits every leg twice: a major fork mid-route and a set-piece relay cut before the finish', () => {
    const found = violations(({ track }) => {
      const { forks, finishDist } = track
      if (forks.length < 2) return `${forks.length} forks`
      for (let i = 0; i < forks.length; i++) {
        const fork = forks[i]!
        if (fork.index !== i || fork.from >= fork.to || fork.to > finishDist) return `fork ${i} malformed`
        if (fork.riskProgress <= ONE || fork.riskLanes > fork.safeLanes) return `fork ${i} risk path is not a narrower shortcut`
        if (mainLanesAtFork(track, fork, 'split') < 2) return `fork ${i} splits a single lane`
        const next = forks[i + 1]
        if (next && next.from - fork.to < 150 * M) return `forks ${i} and ${i + 1} only ${metres(next.from - fork.to)} m apart`
      }
      const first = forks[0]!
      const last = forks.at(-1)!
      if (first.from * 4 < finishDist || first.to * 5 > finishDist * 3) return `first fork ${metres(first.from)}-${metres(first.to)} of ${metres(finishDist)}`
      if (last.label !== 'relay-cut' || finishDist - last.to > 150 * M) return `last fork is not a relay cut near the finish`
      return null
    })
    expect(found).toEqual([])
  })

  it('keeps fork-path features inside their fork and main features outside forks', () => {
    const found = violations(({ track }) => {
      const features = [
        ...track.gates.map(gate => ({ dist: gate.dist, path: gate.path, what: 'gate' })),
        ...track.hazards.map(hazard => ({ dist: hazard.dist, path: hazard.path, what: hazard.kind })),
        ...track.events.map(event => ({ dist: event.dist, path: event.path, what: event.kind })),
        ...[...track.ramps, ...track.gaps, ...track.rails, ...track.boostPads].map(zone => ({ dist: zone.from, path: zone.path, what: 'zone' })),
      ]
      const misplaced = features.find(feature => (feature.path === 'main') === (forkAt(track, feature.dist) !== null))
      return misplaced ? `${misplaced.path} ${misplaced.what} at ${metres(misplaced.dist)} m` : null
    })
    expect(found).toEqual([])
  })

  it('stages a bridge break on every relay cut, with the bridge-break set piece on coast', () => {
    const found = violations(({ world, track }) => {
      const cut = track.forks.at(-1)!
      const breakEvent = track.events.find(event => event.kind === 'bridge-break' && event.path === 'risk' && forkAt(track, event.dist) === cut)
      if (!breakEvent) return 'relay cut without a bridge-break event'
      if (breakEvent.triggerDist >= cut.from) return 'bridge break triggers after the split'
      const ramp = track.ramps.find(zone => zone.path === 'risk' && gatingEventFor(track, zone) === breakEvent)
      const gap = ramp && track.gaps.find(zone => zone.path === 'risk' && zone.from >= ramp.to && zone.from - ramp.to <= 10 * M)
      if (!ramp || !gap) return 'relay cut without its ramp and gap'
      if (world === 'coast' && !track.setPieces.some(piece => piece.kind === 'bridge-break' && piece.dist <= cut.from)) return 'coast finale is not the bridge break'
      return null
    })
    expect(found).toEqual([])
  })

  it('never opens an edge in the first 400 m of a tier 0 leg', () => {
    const found = violations(({ tier, track }) => {
      if (tier !== 0) return null
      const limit = TIER0_PROTECTED_METRES * M
      const segment = track.segments.find(candidate => candidate.from < limit && (candidate.leftEdge === 'open' || candidate.rightEdge === 'open'))
      if (segment) return `open edge at ${metres(segment.from)} m`
      const fork = track.forks.find(candidate => candidate.from < limit
        && [candidate.safeEdges.left, candidate.safeEdges.right, candidate.riskEdges.left, candidate.riskEdges.right].includes('open'))
      return fork ? `open fork edge at ${metres(fork.from)} m` : null
    })
    expect(found).toEqual([])
  })

  it('opens edges somewhere on veteran routes', () => {
    const open = routes.filter(({ tier, track }) => tier === 2 && track.segments.some(segment => segment.leftEdge === 'open' || segment.rightEdge === 'open')).length
    expect(open).toBeGreaterThan(0)
  })
})

describe('relay leg lanes, hazards and events', () => {
  it('puts every gate on a real lane of its path, pulse gates on the outer main lanes', () => {
    const found = violations(({ track }) => {
      for (const gate of track.gates) {
        const layout = laneLayoutAt(track, gate.dist, gate.path)
        if (!isLaneSlot(layout.count, gate.lane)) return `gate at ${metres(gate.dist)} m on slot ${gate.lane} of ${layout.count} lanes`
        if (gate.kind === 'gold' && gate.period !== 0) return `gold gate with a beat at ${metres(gate.dist)} m`
        if (gate.kind === 'pulse' && (gate.path !== 'main' || Math.abs(gate.lane) !== 2 || gate.period !== PULSE_PERIOD)) return `pulse gate at ${metres(gate.dist)} m`
      }
      return null
    })
    expect(found).toEqual([])
  })

  it('leaves a way past every hazard: a free lane, or a jump over a hurdle or a slide under a beam', () => {
    const found = violations(({ track }) => {
      for (const hazard of track.hazards) {
        if (hazard.kind === 'gust') continue
        const layout = laneLayoutAt(track, hazard.dist, hazard.path)
        const where = `${hazard.kind} at ${metres(hazard.dist)} m`
        const validSlots = hazard.kind === 'sweeper' || hazard.kind === 'drone'
          ? hazard.lanes.every(slot => Math.abs(slot) <= layout.count + 1)
          : hazard.lanes.every(slot => isLaneSlot(layout.count, slot))
        if (!validSlots || hazard.lanes.length === 0) return `${where} has lanes ${hazard.lanes.join(',')}`
        if (hazard.kind === 'barrier' || hazard.kind === 'beam') continue
        // Movers on a multi-lane path always leave a lane; on a one-lane path they leave a moving gap.
        let openTicks = 0
        for (let tick = 0; tick < hazard.period; tick++) {
          const free = freeLanes(layout, x => hazardClearance(hazard, layout, tick, x)).length > 0
          if (free) openTicks++
          else if (layout.count > 1) return `${where} blocks every lane at tick ${tick}`
        }
        if (openTicks * 3 < hazard.period) return `${where} leaves its lane open for ${openTicks} of ${hazard.period} ticks`
      }
      return null
    })
    expect(found).toEqual([])
  })

  it('leaves a free lane at every moment of every world event', () => {
    const found = violations(({ track }) => {
      for (const event of track.events) {
        if (event.triggerDist >= event.dist) return `${event.kind} triggers at its own distance`
        if (!collides(event)) continue
        const layout = laneLayoutAt(track, event.dist, event.path)
        const horizon = event.duration + 60 + event.period * 4
        for (let age = 0; age <= horizon; age += 3) {
          if (eventCollision(event, age) === COLLISION.NONE) continue
          if (freeLanes(layout, x => eventClearance(event, age, layout, x)).length === 0) return `${event.kind} at ${metres(event.dist)} m blocks every lane at age ${age}`
        }
      }
      return null
    })
    expect(found).toEqual([])
  })

  it('keeps hands-off couriers safe from events: closures never close the centre lane, winds never reach an edge', () => {
    const found = violations(({ track }) => {
      for (const event of track.events) {
        const layout = laneLayoutAt(track, event.dist, event.path)
        if (event.kind === 'lane-closure' && event.lanes.includes(0)) return `closure over the centre lane at ${metres(event.dist)} m`
        if (event.kind === 'crosswind' && millimetres(Math.abs(event.amplitude)) * GUST_OFFSET_TICKS >= laneEdgeOf(layout)) return `crosswind at ${metres(event.dist)} m pushes the centre lane off the road`
        if (event.kind === 'drone-pattern' && event.count >= event.lanes.length) return 'drone formation fills every lane'
        if (eventBodyCount(event) > 0 && event.kind !== 'drone-pattern' && event.lanes.length !== 2) return `${event.kind} needs a start and an end lane`
      }
      const gusts = track.hazards.filter(hazard => hazard.kind === 'gust')
      const strong = gusts.find(gust => millimetres(Math.abs(gust.amplitude)) * GUST_OFFSET_TICKS >= laneEdgeOf(laneLayoutAt(track, gust.dist, gust.path)))
      return strong ? `gust at ${metres(strong.dist)} m pushes the centre lane off the road` : null
    })
    expect(found).toEqual([])
  })

  it('spaces collidable hazards at least 18 m apart on connected paths (30 m on tier 0) and 25 m from world events', () => {
    const found = violations(({ track, tier }) => {
      const spacing = (tier === 0 ? 30 : 18) * M
      const hazards = track.hazards.filter(isCollidable)
      for (let i = 0; i < hazards.length; i++) {
        for (let j = i + 1; j < hazards.length && hazards[j]!.dist - hazards[i]!.dist < spacing; j++) {
          if (pathsTouch(hazards[i]!.path, hazards[j]!.path)) return `${hazards[i]!.kind} and ${hazards[j]!.kind} at ${metres(hazards[i]!.dist)} m`
        }
        const crowded = track.events.find(event => collides(event) && pathsTouch(event.path, hazards[i]!.path)
          && hazards[i]!.dist > event.dist - 25 * M && hazards[i]!.dist < event.dist + event.length + 25 * M)
        if (crowded) return `${hazards[i]!.kind} at ${metres(hazards[i]!.dist)} m crowds a ${crowded.kind}`
      }
      return null
    })
    expect(found).toEqual([])
  })

  it('ramps every gap: a ramp ends 4-10 m before it and covers its lanes', () => {
    const found = violations(({ track }) => {
      const orphan = track.gaps.find(gap => !track.ramps.some(ramp => ramp.path === gap.path
        && ramp.to <= gap.from - 4 * M && gap.from - ramp.to <= 10 * M && gap.lanes.every(lane => ramp.lanes.includes(lane))))
      return orphan ? `gap at ${metres(orphan.from)} m has no ramp` : null
    })
    expect(found).toEqual([])
  })

  it('keeps ramp air time clear: nothing collidable on landing, no overhead obstacles in reach, nothing to jump in the run-up', () => {
    const found = violations(({ track }) => {
      for (const ramp of track.ramps) {
        for (const hazard of track.hazards.filter(isCollidable)) {
          if (!pathsTouch(ramp.path, hazard.path)) continue
          const afterRamp = hazard.dist - ramp.to
          const beforeRamp = ramp.from - hazard.dist
          if (hazard.dist >= ramp.from - 10 * M && afterRamp <= 50 * M) return `${hazard.kind} ${metres(afterRamp)} m after a ramp`
          const overhead = hazard.kind === 'beam' || hazard.kind === 'drone'
          if (overhead && afterRamp > 0 && afterRamp <= 90 * M) return `${hazard.kind} ${metres(afterRamp)} m after a ramp`
          const jumpable = hazard.kind === 'barrier' || hazard.kind === 'sweeper'
          if (jumpable && beforeRamp > 0 && beforeRamp <= 50 * M) return `${hazard.kind} ${metres(beforeRamp)} m before a ramp`
        }
      }
      return null
    })
    expect(found).toEqual([])
  })

  it('keeps the pulse section in the second half with spaced, clear pulse gates', () => {
    const found = violations(({ track }) => {
      const { pulse, finishDist } = track
      if (pulse.from * 2 < finishDist || pulse.to > finishDist) return `pulse at ${metres(pulse.from)} m`
      if (pulse.period !== PULSE_PERIOD || pulse.window <= 0 || pulse.window >= pulse.period) return 'pulse timing'
      const pulseGates = track.gates.filter(gate => gate.kind === 'pulse')
      if (pulseGates.length < 4) return `${pulseGates.length} pulse gates`
      if (pulseGates.some(gate => gate.dist < pulse.from || gate.dist >= pulse.to)) return 'pulse gate outside the section'
      const minimum = Math.trunc(3 * pulse.period * BASE_SPEED / 2)
      if (pulseGates.some((gate, i) => i > 0 && gate.dist - pulseGates[i - 1]!.dist < minimum)) return 'pulse gates too close'
      if (!track.events.some(event => event.kind === 'pulse-tunnel' && event.dist <= pulse.from)) return 'no pulse tunnel'
      const crowding = track.hazards.find(hazard => pulseGates.some(gate =>
        pathsTouch(gate.path, hazard.path) && gate.dist > hazard.dist - 25 * M && gate.dist < hazard.dist + (hazard.kind === 'gust' ? hazard.length : 0) + 25 * M))
      return crowding ? `${crowding.kind} at ${metres(crowding.dist)} m crowds a pulse gate` : null
    })
    expect(found).toEqual([])
  })
})

describe('relay leg checkpoints', () => {
  it('respawns at every module start and every fork path start except speed-gated risk paths', () => {
    const found = violations(({ track }) => {
      const first = track.checkpoints[0]
      if (!first || first.dist !== 0 || first.path !== 'main' || first.lane !== 0) return 'no start checkpoint'
      const moduleStarts = new Set(track.segments.filter((segment, i) => i === 0 || segment.module !== track.segments[i - 1]!.module).map(segment => segment.from))
      for (const start of moduleStarts) {
        if (!track.checkpoints.some(checkpoint => checkpoint.path === 'main' && checkpoint.dist === start)) return `no checkpoint at module start ${metres(start)} m`
      }
      for (const fork of track.forks) {
        const gated = track.events.some(event => isGatingEvent(event) && forkAt(track, event.dist) === fork)
        const safe = track.checkpoints.some(checkpoint => checkpoint.path === 'safe' && checkpoint.dist === fork.from)
        const risk = track.checkpoints.some(checkpoint => checkpoint.path === 'risk' && checkpoint.dist === fork.from)
        if (!safe || risk === gated) return `fork ${fork.index} checkpoints: safe ${safe}, risk ${risk}, gated ${gated}`
      }
      return null
    })
    expect(found).toEqual([])
  })

  it('never places a checkpoint on a gap or right before an obstacle in its lane', () => {
    const found = violations(({ track }) => {
      for (const checkpoint of track.checkpoints) {
        const layout = laneLayoutAt(track, checkpoint.dist, checkpoint.path)
        const where = `${checkpoint.path} checkpoint at ${metres(checkpoint.dist)} m`
        if (!isLaneSlot(layout.count, checkpoint.lane)) return `${where} on slot ${checkpoint.lane}`
        if ((checkpoint.path === 'main') !== (forkAt(track, checkpoint.dist) === null)) return `${where} is off its path`
        const x = laneCenterX(checkpoint.lane, layout.width)
        const soon = (dist: number, path: Path): boolean => pathsTouch(path, checkpoint.path) && dist >= checkpoint.dist && dist < checkpoint.dist + 12 * M
        if (track.gaps.some((gap: Zone) => soon(gap.from, gap.path) || (pathsTouch(gap.path, checkpoint.path) && gap.from <= checkpoint.dist && gap.to > checkpoint.dist))) return `${where} next to a gap`
        const hazard = track.hazards.find(candidate => isCollidable(candidate) && soon(candidate.dist, candidate.path) && hazardClearance(candidate, layout, 0, x) < 0)
        if (hazard) return `${where} right before a ${hazard.kind}`
        if (track.events.some(event => collides(event) && soon(event.dist, event.path))) return `${where} right before an event`
      }
      return null
    })
    expect(found).toEqual([])
  })
})

describe('relay leg teaching opening', () => {
  it('teaches the centre line, a lane change, a forced change and a jump before any other obstacle', () => {
    const found = violations(({ track }) => {
      const gates = track.gates.slice(0, 5)
      if (gates.slice(0, 3).some(gate => gate.lane !== 0)) return 'opening gates are not on the centre line'
      const side = gates[3]!.lane
      if (Math.abs(side) !== 2 || gates[4]!.lane !== side) return 'no lane change lesson'
      const [lessonBarrier, hurdle] = track.hazards
      if (!lessonBarrier || lessonBarrier.kind !== 'barrier' || lessonBarrier.lanes.join() !== String(side) || lessonBarrier.dist <= gates[4]!.dist) return 'no barrier in the lesson lane'
      if (!hurdle || hurdle.kind !== 'barrier' || hurdle.lanes.length !== 3 || hurdle.dist > 250 * M) return 'no jump lesson'
      const early = track.events.find(event => collides(event) && event.dist < 250 * M)
      return early ? `${early.kind} during the lesson` : null
    })
    expect(found).toEqual([])
  })
})

describe('relay leg rewards and spectacle', () => {
  it('offers at least 40 gates and marks set pieces plus the handoff gate at the finish', () => {
    const found = violations(({ track }) => {
      if (track.gates.length < 40) return `${track.gates.length} gates`
      const handoff = track.setPieces.filter(piece => piece.kind === 'handoff-gate')
      if (handoff.length !== 1 || handoff[0]!.dist !== track.finishDist) return 'handoff gate missing or misplaced'
      const spectacle = track.setPieces.filter(piece => piece.kind !== 'handoff-gate')
      return spectacle.length >= 2 ? null : `${spectacle.length} set pieces`
    })
    expect(found).toEqual([])
  })

  it('shows hazard and world event variety in every world, coast the richest', () => {
    const eventKinds: Record<string, number> = {}
    for (const world of WORLDS) {
      for (const tier of TIERS) {
        const hazards = new Set<HazardKind>()
        const events = new Set<WorldEventKind>()
        routes.filter(route => route.world === world && route.tier === tier).slice(0, 60).forEach(route => {
          route.track.hazards.forEach(hazard => hazards.add(hazard.kind))
          route.track.events.forEach(event => events.add(event.kind))
        })
        expect(hazards.size, `${world} t${tier}: ${[...hazards].join(', ')}`).toBeGreaterThanOrEqual(4)
        expect(events.size, `${world} t${tier}: ${[...events].join(', ')}`).toBeGreaterThanOrEqual(4)
        eventKinds[world] = Math.max(eventKinds[world] ?? 0, events.size)
      }
    }
    expect(Math.max(...Object.values(eventKinds))).toBe(eventKinds.coast)
  })
})

describe('relay leg world identity', () => {
  it('authors at least 10 templates per world with a pool of its own', () => {
    for (const world of WORLDS) {
      const templates = worldTemplates(world)
      expect(templates.length, world).toBeGreaterThanOrEqual(10)
      expect(templates.every(template => template.id.startsWith(`${world}.`)), world).toBe(true)
      expect(new Set(templates.map(template => template.id)).size, world).toBe(templates.length)
    }
  })

  it('draws a different module mix for every world', () => {
    const isHazard = (feature: FeatureTemplate): feature is HazardTemplate => feature.type === 'hazard'
    const shapeMix = (world: World): string => WORLD_KITS[world].pool
      .map(template => `${template.kind}:${template.features.filter(isHazard).map(hazard => hazard.kind).join('+')}`)
      .sort()
      .join('|')
    expect(new Set(WORLDS.map(shapeMix)).size).toBe(WORLDS.length)
  })

  it('carries each world signature on every route', () => {
    const signature: Record<World, (track: Track) => boolean> = {
      coast: track => track.rails.length > 0 && track.events.some(e => e.kind === 'rising-bridge') && track.setPieces.some(p => p.kind === 'bridge-break'),
      metro: track => track.rails.length > 0 && track.setPieces.some(p => p.kind === 'tunnel') && track.segments.some(s => s.leftEdge === 'wall'),
      alpine: track => track.gaps.length >= 2 && track.setPieces.some(p => p.kind === 'cliff-drop'),
      solar: track => track.boostPads.length >= 4 && track.setPieces.some(p => p.kind === 'turbine-field'),
      ocean: track => track.gaps.length >= 2 && track.events.some(e => e.kind === 'rising-bridge') && track.setPieces.some(p => p.kind === 'wave-arch'),
    }
    expect(violations(({ world, track }) => (signature[world](track) ? null : 'missing world signature'))).toEqual([])
  })

  it('draws modules from every template in the pool across seeds', () => {
    for (const world of WORLDS) {
      const used = new Set<string>()
      routes.filter(route => route.world === world).forEach(route => route.track.segments.forEach(segment => used.add(segment.module)))
      expect(worldTemplates(world).filter(template => !used.has(template.id)).map(template => template.id), world).toEqual([])
    }
  })
})

describe('relay leg relay cut', () => {
  /** A courier on the relay cut, 20 m before its ramp, long after the bridge broke. */
  function onCut(world: World, seed: string, speed: number, flow: number): { state: State; gapEnd: number } {
    const config: Config = { engineVersion: '6', challenge: 'relay-leg', challengeVersion: '6', seed, world, tier: 1, openingFlow: 0, tetherSaves: 1, ghostline: null }
    const base = createState(config)
    const cut = base.track.forks.at(-1)!
    const ramp = base.track.ramps.find(zone => zone.path === 'risk' && forkAt(base.track, zone.from) === cut)!
    const gap = base.track.gaps.find(zone => zone.path === 'risk' && zone.from >= ramp.to)!
    const dist = ramp.from - 20 * M
    const state: State = {
      ...base,
      tick: 3000,
      dist,
      gateIdx: base.track.gates.findIndex(gate => gate.dist > dist),
      hazardIdx: base.track.hazards.findIndex(hazard => hazard.dist > dist),
      path: 'risk',
      speed,
      flow,
      riskClean: 1,
      eventTicks: base.track.events.map(() => 0),
      forkChoices: base.track.forks.map((_, i) => (i === cut.index ? 2 : 1)),
    }
    return { state, gapEnd: gap.to }
  }

  function ride(state: State, ticks: number): State[] {
    const states: State[] = []
    let current = state
    for (let i = 0; i < ticks && !current.finished; i++) {
      current = step(current, { shift: 0, nudge: 0, action: 0 })
      states.push(current)
    }
    return states
  }

  it('carries a courier at mid-high FLOW speed across and fails one at low speed', () => {
    for (const world of WORLDS) {
      for (let i = 0; i < 3; i++) {
        const seed = `cut-${i}`
        const threshold = millimetres(640)
        const fast = onCut(world, seed, threshold + Math.trunc(3 * M / 100), Math.trunc(ONE * 70 / 100))
        const fastRun = ride(fast.state, 240)
        expect(fastRun.some(state => (state.events & EVENT.FALL) !== 0), `${world} ${seed} fast`).toBe(false)
        expect(fastRun.some(state => (state.events & EVENT.RISK_CLEAR) !== 0 && state.dist >= fast.gapEnd), `${world} ${seed} fast`).toBe(true)
        const slow = onCut(world, seed, STUMBLE_SPEED, 0)
        expect(ride(slow.state, 240).some(state => (state.events & EVENT.FALL) !== 0), `${world} ${seed} slow`).toBe(true)
      }
    }
  })
})
