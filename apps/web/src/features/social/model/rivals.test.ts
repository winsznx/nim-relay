import { describe, expect, it } from 'vitest'
import type { NetworkRival } from '@nim-relay/shared'
import { rivalView } from './rivals'
import { baton, runner } from './testing'

const ada = runner('ada')
const lena = runner('lena')
const mei = runner('mei')

const rival = (overrides: Partial<NetworkRival> = {}): NetworkRival => ({ id: 'r1', title: 'North vs South', batonIds: ['gold', 'cyan'], target: 10, scores: [7, 4], winnerId: null, createdAt: 0, endsAt: 1_000, ...overrides })

describe('rival view', () => {
  const batons = [baton({ id: 'gold', origin: ada, holder: mei, recipientId: null }), baton({ id: 'cyan', origin: lena, holder: lena, recipientId: 'ada' })]

  it('races gold against cyan toward the target', () => {
    // #when a live rivalry is viewed by a spectator
    const view = rivalView(rival(), batons, null, 500)
    // #then each team shows its progress and the leader
    expect(view.state).toBe('live')
    expect(view.teams.map(team => [team.side, team.score, team.progress])).toEqual([
      ['gold', 7, 0.7],
      ['cyan', 4, 0.4],
    ])
    expect(view.leader).toBe('gold')
  })

  it('tells a team member their team needs a runner when nobody is reserved for the next leg', () => {
    // #given Ada captains gold while Mei holds its baton with no next runner
    const view = rivalView(rival(), batons, 'ada', 500)
    // #then
    expect(view.yourTeam?.side).toBe('gold')
    expect(view.yourTeam?.needsRunner).toBe(true)
    expect(view.yourTeam?.yourTurn).toBe(false)
  })

  it('gives the holder their turn instead of a call for runners', () => {
    const view = rivalView(rival(), batons, 'mei', 500)
    expect(view.yourTeam).toMatchObject({ side: 'gold', yourTurn: true, needsRunner: false })
  })

  it('declares the winner and stops calling for runners', () => {
    // #given the cyan baton reached the target
    const view = rivalView(rival({ scores: [8, 10], winnerId: 'cyan' }), batons, 'ada', 500)
    // #then
    expect(view.state).toBe('won')
    expect(view.winner?.side).toBe('cyan')
    expect(view.yourTeam?.needsRunner).toBe(false)
  })

  it('ends without a winner once time runs out', () => {
    expect(rivalView(rival(), batons, null, 1_000).state).toBe('ended')
  })
})
