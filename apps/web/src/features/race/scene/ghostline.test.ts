import type { relayLeg } from '@nim-relay/game-engine'
import { describe, expect, it } from 'vitest'
import { ghostlineLateral, ghostlineLength, type GhostlineRoute } from './ghostline'

const Q = 65536
const STEP = 4 * Q

/** A straight road with one fork from 40 m to 80 m whose risk path runs 3 m right of the main centre line. */
const route: GhostlineRoute = {
  forks: [{ from: 40, to: 80 }],
  pathOffset(path, d) {
    if (path === 'main' || d <= 40 || d >= 80) return 0
    return path === 'risk' ? 3 : -2
  },
}

function line(samples: readonly (readonly [path: 0 | 1 | 2, xCm: number])[]): relayLeg.Ghostline {
  return { step: STEP, path: samples.map(sample => sample[0]), x: samples.map(sample => sample[1]), tick: samples.map((_, index) => index * 8) }
}

describe('Ghostline lateral', () => {
  it('passes through every sample on the main road', () => {
    // #given a ghost drifting one lane right over 16 m
    const ghostline = line([[0, 0], [0, 50], [0, 150], [0, 200], [0, 200]])
    // #when the line is read at each sample
    const laterals = [0, 4, 8, 12, 16].map(d => ghostlineLateral(ghostline, route, d))
    // #then it goes exactly through the ghost's positions
    expect(laterals.map(value => value?.toFixed(3))).toEqual(['0.000', '0.500', '1.500', '2.000', '2.000'])
  })

  it('curves smoothly between samples instead of kinking', () => {
    // #given the same drift
    const ghostline = line([[0, 0], [0, 50], [0, 150], [0, 200], [0, 200]])
    // #when it is read between the second and third samples
    const middle = ghostlineLateral(ghostline, route, 6)
    // #then it lies between them
    expect(middle).toBeGreaterThan(0.5)
    expect(middle).toBeLessThan(1.5)
  })

  it('follows the fork path the ghost took, including a sample on the boundary', () => {
    // #given a ghost that took the risk path, sampled exactly where the fork opens and inside it
    const samples: [0 | 1 | 2, number][] = Array.from({ length: 16 }, (_, index) => [index >= 10 && index <= 19 ? 2 : 0, 0])
    const ghostline = line(samples)
    // #when the line is read at the fork boundary and inside the fork
    const atBoundary = ghostlineLateral(ghostline, route, 40)
    const inside = ghostlineLateral(ghostline, route, 52)
    // #then both sit on the risk path's centre line
    expect(atBoundary).toBeCloseTo(3, 6)
    expect(inside).toBeCloseTo(3, 6)
  })

  it('is empty past the end of the line and for a line too short to draw', () => {
    // #given a 16 m line and a single-sample line
    const ghostline = line([[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]])
    // #then nothing is read beyond them
    expect(ghostlineLength(ghostline)).toBe(16)
    expect(ghostlineLateral(ghostline, route, 16.5)).toBeNull()
    expect(ghostlineLateral(ghostline, route, -1)).toBeNull()
    expect(ghostlineLateral(line([[0, 0]]), route, 0)).toBeNull()
  })
})
