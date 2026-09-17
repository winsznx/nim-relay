import { describe, expect, it } from 'vitest'
import type { BatonHandoff, NetworkRunner } from '@nim-relay/shared'
import type { Profile, State } from '../../model'
import { DAY_MS } from '../constants'
import { freshNetworkState } from '../state'
import type { NetworkContext } from '../types'
import { ATLAS_EXPLORER_ROUTES, meetsRequirement, SOCIAL_CREW_STREAK_DAYS } from './eligibility'

const NOON = Date.UTC(2026, 8, 17, 12)

function runner(id: string): NetworkRunner {
  return { id, name: id, handle: id, wallet: `NQ-${id}`, country: null, countrySource: null }
}

function handoff(from: string, to: string, at: number, batonId = 'baton'): BatonHandoff {
  return { id: `${from}-${at}`, batonId, leg: 1, from: runner(from), to: runner(to), value: 100_000, txHash: 'a'.repeat(64), network: 'TestAlbatross', at, runId: 'run', resultHash: 'r', qualified: true, confirmations: 2, blockNumber: 1, sector: 0, race: null, rescue: false, note: null, atlas: { routeId: 'genesis-cape-verdigris', origin: 'genesis', destination: 'cape-verdigris', backfilled: false, onCourse: true } }
}

function context(): NetworkContext {
  const players: Record<string, Profile> = {}
  for (const id of ['ana', 'ben', 'cy']) players[id] = { id, wallet: `NQ-${id}` } as Profile
  const product = { players, crews: [] } as unknown as State
  return { state: freshNetworkState(), product } as unknown as NetworkContext
}

describe('grant milestones', () => {
  it('first handoff needs a verified handoff the runner sent, not one they received', () => {
    // #given ben received a handoff from ana
    const ctx = context()
    ctx.state.handoffs.push(handoff('ana', 'ben', NOON))
    // #then only ana has made her first handoff
    expect([meetsRequirement(ctx, 'ana', 'first_handoff', NOON), meetsRequirement(ctx, 'ben', 'first_handoff', NOON)]).toEqual([true, false])
  })

  it('return handoff needs a second verified handoff on a later UTC day', () => {
    const ctx = context()
    ctx.state.handoffs.push(handoff('ana', 'ben', NOON), handoff('ana', 'ben', NOON + 60_000))
    expect(meetsRequirement(ctx, 'ana', 'return_handoff', NOON)).toBe(false)
    ctx.state.handoffs.push(handoff('ana', 'ben', NOON + DAY_MS))
    expect(meetsRequirement(ctx, 'ana', 'return_handoff', NOON + DAY_MS)).toBe(true)
  })

  it('Atlas explorer reads completed routes from the Atlas', () => {
    const ctx = context()
    const routes = ['r1', 'r2', 'r3'].slice(0, ATLAS_EXPLORER_ROUTES - 1)
    ctx.state.atlas.players.ana = { stations: [], routes, legs: routes.length, routesLit: 0, missions: {} }
    expect(meetsRequirement(ctx, 'ana', 'atlas_explorer', NOON)).toBe(false)
    ctx.state.atlas.players.ana.routes.push('r-last')
    expect(meetsRequirement(ctx, 'ana', 'atlas_explorer', NOON)).toBe(true)
  })

  it('social counts an invited runner on another wallet who has passed a baton, or a crew streak the runner helped', () => {
    const ctx = context()
    ctx.state.invites.token = { id: 'i', token: '', batonId: 'baton', from: runner('ana'), recipientId: null, createdAt: NOON, expiresAt: NOON + DAY_MS, claimedBy: 'ben', url: '' }
    expect(meetsRequirement(ctx, 'ana', 'social', NOON)).toBe(false)
    ctx.state.handoffs.push(handoff('ben', 'cy', NOON))
    expect(meetsRequirement(ctx, 'ana', 'social', NOON)).toBe(true)

    ctx.product.crews.push({ id: 'crew', name: 'Crew', code: 'C', members: ['cy', 'ben'] })
    ctx.state.batons.crewBaton = { crewId: 'crew' } as NetworkContext['state']['batons'][string]
    expect(meetsRequirement(ctx, 'cy', 'social', NOON)).toBe(false)
    ctx.state.handoffs.push(handoff('cy', 'ben', NOON, 'crewBaton'))
    for (let day = 0; day < SOCIAL_CREW_STREAK_DAYS; day++) ctx.state.crewDays.crew = { ...ctx.state.crewDays.crew, [new Date(NOON - day * DAY_MS).toISOString().slice(0, 10)]: 1 }
    expect(meetsRequirement(ctx, 'cy', 'social', NOON)).toBe(true)
  })
})
