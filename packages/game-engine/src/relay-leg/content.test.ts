import { describe, expect, it } from 'vitest'
import { ONE } from '../fixed-point'
import { WORLD_KITS, worldTemplates, type FeatureTemplate, type HazardTemplate } from './modules'
import { GRAVITY, JUMP_VELOCITY, LOW_HAZARD_HEIGHT, TRAIN_HEIGHT, halfWidthAt } from './sim'
import { buildTrack, pathsTouch } from './track'
import { WORLDS, type Hazard, type HazardKind, type Tier, type Track, type World } from './types'

const SEEDS = 500
const TIERS: readonly Tier[] = [0, 1, 2]
const M = ONE
/** Lateral room a courier needs to slip past something. */
const COURIER_ROOM = Math.trunc(ONE / 2)

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

/** Lateral room on each side of a hazard at its widest reach. */
function sideRooms(track: Track, hazard: Hazard): { left: number; right: number; halfWidth: number } {
  const halfWidth = halfWidthAt(track, hazard.dist, hazard.path)
  const reach = hazard.kind === 'sweeper' || hazard.kind === 'drone' ? hazard.amplitude : 0
  return {
    left: hazard.x - reach - hazard.half + halfWidth,
    right: halfWidth - (hazard.x + reach + hazard.half),
    halfWidth,
  }
}

/** Every legal way past a hazard: steer around it, jump over it or slide under it. */
function legalOptions(track: Track, hazard: Hazard): string[] {
  const { left, right, halfWidth } = sideRooms(track, hazard)
  const options: string[] = []
  switch (hazard.kind) {
    case 'barrier':
    case 'sweeper':
      if (left >= COURIER_ROOM || right >= COURIER_ROOM || moverLeavesRoom(hazard, halfWidth)) options.push('steer')
      if (jumpApex() >= LOW_HAZARD_HEIGHT) options.push('jump')
      break
    case 'drone':
      if (left >= COURIER_ROOM || right >= COURIER_ROOM || moverLeavesRoom(hazard, halfWidth)) options.push('steer')
      options.push('slide')
      break
    case 'beam':
      options.push('slide')
      break
    case 'door':
      // The open side alternates, so both sides must fit a courier.
      if (left >= COURIER_ROOM && right >= COURIER_ROOM) options.push('steer')
      break
    case 'train':
      if (hazard.x + halfWidth >= COURIER_ROOM && halfWidth - hazard.x >= COURIER_ROOM) options.push('steer')
      if (jumpApex() >= TRAIN_HEIGHT) options.push('jump')
      break
    case 'gust':
      // Steering settles six pushes downwind of its target, which must stay on the deck.
      if (Math.abs(hazard.amplitude) * 6 < halfWidth) options.push('steer')
      break
  }
  return options
}

/** A mover sweeping through the centre still leaves one side open at every instant. */
function moverLeavesRoom(hazard: Hazard, halfWidth: number): boolean {
  if (hazard.kind !== 'sweeper' && hazard.kind !== 'drone') return false
  const closestToCentre = Math.max(0, Math.abs(hazard.x) - hazard.amplitude)
  return halfWidth - closestToCentre - hazard.half >= COURIER_ROOM
}

function jumpApex(): number {
  const ticks = Math.trunc(JUMP_VELOCITY / GRAVITY)
  return JUMP_VELOCITY * ticks - Math.trunc(GRAVITY * ticks * (ticks + 1) / 2)
}

describe('relay leg route shape', () => {
  it('keeps every route between 1400 and 1800 m', () => {
    // #given 500 seeds for every world and tier
    // #when checking finish distances
    const found = violations(({ track }) =>
      track.finishDist >= 1400 * M && track.finishDist <= 1800 * M ? null : `length ${metres(track.finishDist)} m`)
    // #then all are in bounds
    expect(found).toEqual([])
  })

  it('lays segments contiguously from 0 to the finish with continuous ground', () => {
    const found = violations(({ track }) => {
      const segments = track.segments
      if (segments[0]?.from !== 0) return 'first segment does not start at 0'
      if (segments.at(-1)?.to !== track.finishDist) return 'last segment does not end at the finish'
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]!
        if (segment.index !== i || segment.to <= segment.from) return `segment ${i} is malformed`
        const next = segments[i + 1]
        if (next && (next.from !== segment.to || next.elevationFrom !== segment.elevationTo)) return `seam after segment ${i}`
      }
      return null
    })
    expect(found).toEqual([])
  })

  it('places exactly one fork inside the middle third', () => {
    const found = violations(({ track }) => {
      const { fork, finishDist } = track
      const forkSegments = track.segments.filter(segment => segment.kind === 'fork' && segment.from === fork.from)
      if (forkSegments.length !== 1) return 'fork body segment missing'
      if (fork.from * 3 < finishDist || fork.to * 3 > finishDist * 2) return `fork ${metres(fork.from)}-${metres(fork.to)} of ${metres(finishDist)}`
      if (fork.riskProgress <= ONE || fork.riskHalfWidth >= fork.safeHalfWidth) return 'risk path is not a narrower shortcut'
      return null
    })
    expect(found).toEqual([])
  })

  it('places the pulse section in the second half with its pulse gates inside it', () => {
    const found = violations(({ track }) => {
      const { pulse, finishDist } = track
      if (pulse.from * 2 < finishDist || pulse.to > finishDist) return `pulse at ${metres(pulse.from)} m`
      if (pulse.period !== 28 || pulse.window <= 0 || pulse.window >= pulse.period) return 'pulse timing'
      const stray = track.gates.find(gate => gate.kind === 'pulse' && (gate.dist < pulse.from || gate.dist >= pulse.to))
      return stray ? `pulse gate outside the section at ${metres(stray.dist)} m` : null
    })
    expect(found).toEqual([])
  })

  it('keeps fork-path features inside the fork and main features outside it', () => {
    const found = violations(({ track }) => {
      const { from, to } = track.fork
      const features = [
        ...track.gates.map(gate => ({ dist: gate.dist, path: gate.path })),
        ...track.hazards.map(hazard => ({ dist: hazard.dist, path: hazard.path })),
        ...[...track.ramps, ...track.gaps, ...track.rails, ...track.boostPads].map(zone => ({ dist: zone.from, path: zone.path })),
      ]
      const misplaced = features.find(feature => (feature.path === 'main') === (feature.dist >= from && feature.dist < to))
      return misplaced ? `${misplaced.path} feature at ${metres(misplaced.dist)} m` : null
    })
    expect(found).toEqual([])
  })

  it('sorts every feature list by distance', () => {
    const sorted = (values: readonly number[]): boolean => values.every((value, i) => i === 0 || values[i - 1]! <= value)
    const found = violations(({ track }) => {
      const lists: Record<string, readonly number[]> = {
        gates: track.gates.map(gate => gate.dist),
        hazards: track.hazards.map(hazard => hazard.dist),
        ramps: track.ramps.map(zone => zone.from),
        gaps: track.gaps.map(zone => zone.from),
        rails: track.rails.map(zone => zone.from),
        boostPads: track.boostPads.map(zone => zone.from),
        setPieces: track.setPieces.map(piece => piece.dist),
      }
      const unsorted = Object.entries(lists).find(([, values]) => !sorted(values))
      return unsorted ? `${unsorted[0]} unsorted` : null
    })
    expect(found).toEqual([])
  })

  it('builds identical tracks for identical configs and different tracks for different seeds', () => {
    // #given the same config twice and a neighbouring seed
    const config = { seed: 'determinism', world: 'metro', tier: 1 } as const
    // #when building
    const a = buildTrack(config)
    const b = buildTrack(config)
    const other = buildTrack({ ...config, seed: 'determinism-2' })
    // #then identical inputs agree exactly and seeds matter
    expect(b).toEqual(a)
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(a))
  })
})

describe('relay leg fairness', () => {
  it('leaves a legal option past every hazard', () => {
    const found = violations(({ track }) => {
      for (const hazard of track.hazards) {
        if (Math.abs(hazard.x) > halfWidthAt(track, hazard.dist, hazard.path)) return `${hazard.kind} off the deck at ${metres(hazard.dist)} m`
        if (legalOptions(track, hazard).length === 0) return `no way past the ${hazard.kind} at ${metres(hazard.dist)} m`
      }
      return null
    })
    expect(found).toEqual([])
  })

  it('always leaves a lane to steer around barriers, sweepers and drones', () => {
    const found = violations(({ track }) => {
      const blocking = track.hazards.find(hazard =>
        ['barrier', 'sweeper', 'drone'].includes(hazard.kind) && !legalOptions(track, hazard).includes('steer'))
      return blocking ? `${blocking.kind} at ${metres(blocking.dist)} m spans the deck` : null
    })
    expect(found).toEqual([])
  })

  it('spaces collidable hazards at least 18 m apart on connected paths (30 m on tier 0)', () => {
    const found = violations(({ track, tier }) => {
      const spacing = (tier === 0 ? 30 : 18) * M
      const hazards = track.hazards.filter(isCollidable)
      for (let i = 0; i < hazards.length; i++) {
        for (let j = i + 1; j < hazards.length && hazards[j]!.dist - hazards[i]!.dist < spacing; j++) {
          if (pathsTouch(hazards[i]!.path, hazards[j]!.path)) return `${hazards[i]!.kind} and ${hazards[j]!.kind} at ${metres(hazards[i]!.dist)} m`
        }
      }
      return null
    })
    expect(found).toEqual([])
  })

  it('puts a ramp within 40 m before every gap on the same path', () => {
    const found = violations(({ track }) => {
      const orphan = track.gaps.find(gap => !track.ramps.some(ramp =>
        ramp.path === gap.path && ramp.to <= gap.from && gap.from - ramp.to <= 40 * M))
      return orphan ? `gap at ${metres(orphan.from)} m has no ramp` : null
    })
    expect(found).toEqual([])
  })

  it('keeps ramp air time clear: nothing collidable on landing, no beams in reach, nothing to jump in the run-up', () => {
    const found = violations(({ track }) => {
      for (const ramp of track.ramps) {
        for (const hazard of track.hazards.filter(isCollidable)) {
          if (!pathsTouch(ramp.path, hazard.path)) continue
          const afterRamp = hazard.dist - ramp.to
          const beforeRamp = ramp.from - hazard.dist
          if (hazard.dist >= ramp.from - 10 * M && afterRamp <= 50 * M) return `${hazard.kind} ${metres(afterRamp)} m after a ramp`
          if (hazard.kind === 'beam' && afterRamp > 0 && afterRamp <= 90 * M) return `beam ${metres(afterRamp)} m after a ramp`
          const jumpable = hazard.kind === 'barrier' || hazard.kind === 'sweeper'
          if (jumpable && beforeRamp > 0 && beforeRamp <= 50 * M) return `${hazard.kind} ${metres(beforeRamp)} m before a ramp`
        }
      }
      return null
    })
    expect(found).toEqual([])
  })

  it('keeps tier 0 calm: no hazards in the first 150 m and no doors or trains before 400 m', () => {
    const found = violations(({ track, tier }) => {
      if (tier !== 0) return null
      const early = track.hazards.find(hazard => hazard.dist < 150 * M)
      if (early) return `${early.kind} at ${metres(early.dist)} m`
      const timed = track.hazards.find(hazard => (hazard.kind === 'door' || hazard.kind === 'train') && hazard.dist < 400 * M)
      return timed ? `${timed.kind} at ${metres(timed.dist)} m` : null
    })
    expect(found).toEqual([])
  })

  it('keeps the gap tutorial behind the first ramp', () => {
    const found = violations(({ track }) => {
      const firstRamp = track.ramps[0]
      const firstGap = track.gaps[0]
      if (!firstRamp) return 'no ramp'
      return firstGap && firstGap.from < firstRamp.to ? 'a gap comes before the first ramp' : null
    })
    expect(found).toEqual([])
  })
})

describe('relay leg rewards and spectacle', () => {
  it('offers at least 24 gates, all reachable on their path', () => {
    const found = violations(({ track }) => {
      if (track.gates.length < 24) return `${track.gates.length} gates`
      const unreachable = track.gates.find(gate => Math.abs(gate.x) > halfWidthAt(track, gate.dist, gate.path))
      return unreachable ? `gate off the deck at ${metres(unreachable.dist)} m` : null
    })
    expect(found).toEqual([])
  })

  it('marks at least two set pieces plus the handoff gate at the finish', () => {
    const found = violations(({ track }) => {
      const handoff = track.setPieces.filter(piece => piece.kind === 'handoff-gate')
      if (handoff.length !== 1 || handoff[0]!.dist !== track.finishDist) return 'handoff gate missing or misplaced'
      const spectacle = track.setPieces.filter(piece => piece.kind !== 'handoff-gate')
      return spectacle.length >= 2 ? null : `${spectacle.length} set pieces`
    })
    expect(found).toEqual([])
  })

  it('shows at least 6 distinct hazard kinds across 50 seeds of every world and tier', () => {
    for (const world of WORLDS) {
      for (const tier of TIERS) {
        // #given the first 50 seeds of one world and tier
        const kinds = new Set<HazardKind>()
        routes.filter(route => route.world === world && route.tier === tier).slice(0, 50)
          .forEach(route => route.track.hazards.forEach(hazard => kinds.add(hazard.kind)))
        // #then the world has real variety
        expect(kinds.size, `${world} t${tier}: ${[...kinds].join(', ')}`).toBeGreaterThanOrEqual(6)
      }
    }
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
    const mixes = new Set(WORLDS.map(shapeMix))
    expect(mixes.size).toBe(WORLDS.length)
  })

  it('carries each world signature on every route', () => {
    const signature: Record<World, (track: Track) => boolean> = {
      coast: track => track.rails.length > 0 && track.ramps.length >= 2 && track.setPieces.some(p => p.kind === 'suspension-bridge'),
      metro: track => track.rails.length > 0 && track.hazards.some(h => h.kind === 'train') && track.hazards.some(h => h.kind === 'door'),
      alpine: track => track.gaps.length >= 3 && track.hazards.some(h => h.kind === 'gust') && track.setPieces.some(p => p.kind === 'cliff-drop'),
      solar: track => track.boostPads.length >= 4 && track.hazards.filter(h => h.kind === 'sweeper').length >= 3,
      ocean: track => track.gaps.length >= 3 && track.hazards.some(h => h.kind === 'door') && track.hazards.some(h => h.kind === 'drone'),
    }
    const found = violations(({ world, track }) => (signature[world](track) ? null : 'missing world signature'))
    expect(found).toEqual([])
  })

  it('draws modules from every template in the pool across seeds', () => {
    for (const world of WORLDS) {
      const used = new Set<string>()
      routes.filter(route => route.world === world).forEach(route => route.track.segments.forEach(segment => used.add(segment.module)))
      const unused = worldTemplates(world).filter(template => !used.has(template.id)).map(template => template.id)
      expect(unused, world).toEqual([])
    }
  })
})
