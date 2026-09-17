import { describe, expect, it } from 'vitest'
import { relayLeg } from '@nim-relay/game-engine'
import { blockedExtent, laneRuns } from './events/kit'
import { Q, Route } from './route'
import { gapHoles, pathIntervals, spansAt } from './track-spans'

/**
 * The race world is only fair if what is drawn is what the simulation resolves.
 * These check the renderer's road geometry against the engine's own rules on
 * real v6 tracks for every world.
 */

const SEEDS = ['dev-leg', 'closure-b'] as const

function tracks(): relayLeg.Track[] {
  return SEEDS.flatMap(seed => relayLeg.WORLDS.map(world => relayLeg.buildTrack({ seed, world, tier: 1 })))
}

const CENTIMETRE = 0.01

describe('track geometry agrees with the engine', () => {
  it('lays fork paths where the engine says their centre lines are', () => {
    for (const track of tracks()) {
      // #given a route over a v6 track with forks
      const route = new Route(track)
      for (const fork of track.forks) {
        for (let step = 0; step <= 40; step++) {
          const q = fork.from + Math.trunc(((fork.to - fork.from - 1) * step) / 40)
          for (const path of ['safe', 'risk'] as const) {
            // #when the renderer places the path centre
            const drawn = route.pathOffset(path, q / Q)
            // #then it matches the engine's offset
            expect(Math.abs(drawn - relayLeg.pathOffsetAt(track, q, path) / Q)).toBeLessThan(CENTIMETRE)
          }
        }
      }
    }
  })

  it('reads lane counts, widths, shoulders and edges from the engine layout', () => {
    for (const track of tracks()) {
      const route = new Route(track)
      for (let q = 0; q < track.finishDist; q += 7 * Q) {
        for (const path of ['main', 'safe', 'risk'] as const) {
          // #given the engine layout at a distance
          const layout = relayLeg.laneLayoutAt(track, q, relayLeg.activePathAt(track, q, path))
          // #when the renderer reads the same place
          const lanes = route.lanes(route.activePath(path, q / Q), q / Q)
          // #then every field agrees
          expect([lanes.count, lanes.left, lanes.right]).toEqual([layout.count, layout.leftEdge, layout.rightEdge])
          expect(Math.abs(route.halfWidth(route.activePath(path, q / Q), q / Q) - layout.halfWidth / Q)).toBeLessThan(CENTIMETRE)
        }
      }
    }
  })

  it('cuts deck holes exactly where gaps make a courier fall', () => {
    for (const track of tracks()) {
      const route = new Route(track)
      for (const gap of track.gaps) {
        // #given the middle of a gap on its path
        const q = Math.trunc((gap.from + gap.to) / 2)
        const d = q / Q
        const layout = relayLeg.laneLayoutAt(track, q, gap.path)
        const centre = route.pathOffset(gap.path, d)
        const holes = gapHoles(route, d, pathIntervals(route, d))
        for (let x = -layout.halfWidth; x <= layout.halfWidth; x += Q / 4) {
          // #when a lateral position is checked against the engine's zone rule
          const covered = gap.lanes.length >= layout.count
            ? Math.abs(x) <= layout.halfWidth
            : gap.lanes.some(slot => Math.abs(x - relayLeg.laneCenterX(slot, layout.width)) <= Math.trunc(layout.width / 2))
          const lateral = centre + x / Q
          const inHole = holes.some(hole => lateral > hole.left + CENTIMETRE && lateral < hole.right - CENTIMETRE)
          const onEdge = holes.some(hole => Math.abs(lateral - hole.left) <= CENTIMETRE || Math.abs(lateral - hole.right) <= CENTIMETRE)
          // #then the deck has a hole there exactly when the courier would fall
          if (!onEdge) expect(inHole).toBe(covered)
        }
      }
    }
  })

  it('splits the deck into two ribbons where a fork parts and back into one after', () => {
    for (const track of tracks()) {
      const route = new Route(track)
      for (const fork of track.forks) {
        // #given a fork's middle and a point well past its end
        const middle = (fork.from + fork.to) / 2 / Q
        const after = fork.to / Q + 5
        // #then there are two decks mid-fork and one after it
        expect(spansAt(route, middle).length).toBeGreaterThanOrEqual(2)
        expect(spansAt(route, after).length).toBeGreaterThanOrEqual(1)
        expect(route.forkAt(after)).toBeNull()
      }
    }
  })

  it('draws event blocks over exactly the lateral span the engine blocks', () => {
    for (const track of tracks()) {
      const route = new Route(track)
      for (const event of track.events) {
        if (event.kind !== 'lane-closure' && event.kind !== 'collapsing-gantry') continue
        // #given a blocking event's lanes at its distance
        const layout = relayLeg.laneLayoutAt(track, event.dist, event.path)
        const d = event.dist / Q
        const centre = route.pathOffset(event.path, d)
        const extents = laneRuns(event.lanes).map(run => blockedExtent(route, event.path, d, run, { left: 0, right: 0 }))
        const sorted = [...event.lanes].sort((a, b) => a - b)
        for (let x = -layout.halfWidth; x <= layout.halfWidth; x += Q / 5) {
          // #when a position is inside the drawn blocks
          const lateral = centre + x / Q
          const drawn = extents.some(extent => lateral > extent.left + CENTIMETRE && lateral < extent.right - CENTIMETRE)
          const onEdge = extents.some(extent => Math.abs(lateral - extent.left) <= CENTIMETRE || Math.abs(lateral - extent.right) <= CENTIMETRE)
          // #then the engine blocks it too
          if (!onEdge) expect(drawn).toBe(relayLeg.laneBlockClearance(layout, sorted, x) < 0)
        }
      }
    }
  })
})
