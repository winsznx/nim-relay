import { describe, expect, it } from 'vitest'
import { relayLeg } from '@nim-relay/game-engine'
import type { BatonHandoff, NetworkRunner } from '@nim-relay/shared'
import { baton, runner } from '../social/model/testing'
import { legMission } from './mission'
import type { LegSetup } from './prepare'
import type { HandoffRoster } from './runner-groups'

const tim = runner('tim', 'Tim')
const me = runner('me', 'Mariana')
const aurora = baton({ id: 'aurora', displayName: 'Aurora', holder: me, handoffCount: 1 })

const config: relayLeg.Config = {
  engineVersion: relayLeg.ENGINE_VERSION,
  challenge: relayLeg.CHALLENGE,
  challengeVersion: relayLeg.ENGINE_VERSION,
  seed: 'seed',
  world: 'coast',
  tier: 1,
  openingFlow: 0,
  tetherSaves: 1,
  ghostline: null,
}

function handoff(from: NetworkRunner, overrides: Partial<BatonHandoff> = {}): BatonHandoff {
  return { id: 'h-1', batonId: aurora.id, leg: 1, from, to: me, value: 100_000, txHash: 'f'.repeat(64), network: 'TestAlbatross', at: 0, runId: 'run-tim', resultHash: 'r', qualified: true, confirmations: 2, blockNumber: 1, sector: 0, race: null, rescue: false, note: null, ...overrides }
}

function setup(overrides: Partial<LegSetup> = {}): LegSetup {
  return {
    config,
    mode: 'relay',
    ghost: { config, trace: [], name: 'Tim', country: null, timeMs: 44_120 },
    ghostRunId: 'run-tim',
    playback: null,
    issued: null,
    sender: { name: 'Tim', country: null },
    baton: aurora,
    handoffs: [handoff(tim, { note: { text: 'Don’t drop the baton.', visibility: 'private' } })],
    appearance: undefined,
    echoes: [],
    firstOnSector: false,
    ...overrides,
  }
}

const yasmineWaiting: HandoffRoster = {
  kind: 'known',
  runner: { id: 'yasmine', name: 'Yasmine', handle: 'yasmine', wallet: null, country: null, context: 'Accepted your invite' },
  status: 'ready',
  others: null,
}

describe('leg mission', () => {
  it('tells the runner whose baton it is, who ran before, who waits and what they said', () => {
    expect(legMission(setup(), yasmineWaiting)).toEqual({
      batonName: 'Aurora',
      previous: { name: 'Tim', timeMs: 44_120 },
      next: { name: 'Yasmine', context: 'Accepted your invite' },
      note: { from: 'Tim', text: 'Don’t drop the baton.' },
    })
  })

  it('leaves out a time that is not the previous runner’s and a next runner nobody has chosen', () => {
    const openRoster: HandoffRoster = { kind: 'open', sections: [], recommended: null, invite: true, directory: [], rule: null }
    const mission = legMission(setup({ ghostRunId: 'run-someone-else' }), openRoster)
    expect(mission).toMatchObject({ previous: { name: 'Tim', timeMs: null }, next: null })
  })

  it('starts a fresh baton without a previous runner or note', () => {
    expect(legMission(setup({ handoffs: [], ghost: null, ghostRunId: null, sender: null }), null)).toEqual({ batonName: 'Aurora', previous: null, next: null, note: null })
  })

  it('has no mission outside a baton leg', () => {
    expect(legMission(setup({ mode: 'practice', baton: null, handoffs: [] }), null)).toBeNull()
    expect(legMission(setup({ mode: 'daily', baton: null, handoffs: [] }), null)).toBeNull()
  })
})
