import { describe, expect, it } from 'vitest'
import { ATLAS_ROUTES, ATLAS_STATIONS, GENESIS_STATION_ID, atlasRoute, defaultRouteFrom, genesisRouteFor, outgoingRoutes } from './atlas'

const WORLDS = ['coast', 'alpine', 'metro', 'solar', 'ocean'] as const

describe('relay atlas catalogue', () => {
  it('has unique stations and routes that name known stations', () => {
    expect(new Set(ATLAS_STATIONS.map(station => station.id)).size).toBe(ATLAS_STATIONS.length)
    expect(new Set(ATLAS_ROUTES.map(route => route.id)).size).toBe(ATLAS_ROUTES.length)
    expect(new Set(ATLAS_ROUTES.map(route => route.seed)).size).toBe(ATLAS_ROUTES.length)
    expect(ATLAS_STATIONS.length).toBeGreaterThanOrEqual(16)
    expect(ATLAS_STATIONS.length).toBeLessThanOrEqual(24)
    expect(ATLAS_ROUTES.length).toBeGreaterThanOrEqual(30)
    expect(ATLAS_ROUTES.length).toBeLessThanOrEqual(60)
    expect(ATLAS_STATIONS.find(station => station.id === GENESIS_STATION_ID)?.name).toBe('Genesis Station')
  })

  it('gives every station 2 to 4 routes out, Genesis one into each world', () => {
    for (const station of ATLAS_STATIONS) {
      const count = outgoingRoutes(station.id).length
      if (station.id === GENESIS_STATION_ID) expect(count).toBe(WORLDS.length)
      else expect([station.id, count >= 2 && count <= 4]).toEqual([station.id, true])
    }
    for (const world of WORLDS) expect(genesisRouteFor(world).world).toBe(world)
  })

  it('reaches every station from Genesis and returns to Genesis', () => {
    const seen = new Set([GENESIS_STATION_ID])
    const queue = [GENESIS_STATION_ID]
    while (queue.length > 0) {
      for (const route of outgoingRoutes(queue.shift()!)) {
        if (seen.has(route.to)) continue
        seen.add(route.to)
        queue.push(route.to)
      }
    }
    expect(seen.size).toBe(ATLAS_STATIONS.length)
    expect(ATLAS_ROUTES.some(route => route.to === GENESIS_STATION_ID)).toBe(true)
  })

  it('races the destination world on a frozen seed', () => {
    const route = atlasRoute('genesis-to-cape-verdigris')
    expect(route).toEqual({ id: 'genesis-to-cape-verdigris', from: 'genesis', to: 'cape-verdigris', world: 'coast', tier: 0, seed: 'atlas-v1-genesis-to-cape-verdigris' })
  })

  it('picks the same default route for the same station and key', () => {
    const first = defaultRouteFrom('monsoon-deck', 'ABC:3')
    expect(defaultRouteFrom('monsoon-deck', 'ABC:3')).toEqual(first)
    expect(first.from).toBe('monsoon-deck')
    const picks = new Set(Array.from({ length: 40 }, (_, index) => defaultRouteFrom('monsoon-deck', `key-${index}`).id))
    expect(picks.size).toBeGreaterThan(1)
  })
})
