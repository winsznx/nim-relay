import { ATLAS_ROUTES } from '@nim-relay/shared'
import { describe, expect, it } from 'vitest'
import { replay } from './result'
import { playLeg, skilledBot } from './test-bots'
import { buildTrack } from './track'
import type { Config } from './types'

/** Every Relay Atlas route maps to a real v6 course that a courier can finish. */
describe('relay atlas routes', () => {
  it.each(ATLAS_ROUTES.map(route => [route.id, route] as const))('%s builds and finishes', (_id, route) => {
    // #given the course the route races, as the server issues it with no inherited FLOW and no ghost
    const config: Config = { engineVersion: '6', challenge: 'relay-leg', challengeVersion: '6', seed: route.seed, world: route.world, tier: route.tier, openingFlow: 0, tetherSaves: 1, ghostline: null }
    expect(buildTrack(config).finishDist).toBeGreaterThan(0)

    // #when the skilled courier rides it
    const { trace } = playLeg(config, skilledBot('safe'))

    // #then the server's replay of that ride finishes the leg without failing
    const result = replay({ ...config, inputTrace: trace })
    expect([result.completed, result.failed]).toEqual([true, false])
  })
})
