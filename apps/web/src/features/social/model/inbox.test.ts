import { describe, expect, it } from 'vitest'
import { inboxSections } from './inbox'
import { HOUR, baton, crew, notification, runner, snapshot } from './testing'

const me = runner('me', 'Mateo')
const mei = runner('mei', 'Mei')

describe('inbox sections', () => {
  it('puts a baton the runner holds under needs you now, folding in its arrival notice', () => {
    // #given an unread arrival for a baton the runner now holds
    const held = baton({ id: 'b1', holder: me, handoffCount: 4, expiresAt: 30 * HOUR })
    const arrival = notification({ id: 'n1', type: 'incoming_baton', title: 'Mei passed you the baton', batonId: 'b1', createdAt: 5 })
    // #when
    const { now, updates } = inboxSections(snapshot({ batons: [held], inbox: [arrival] }), 'me')
    // #then one item carries the runner to the leg and marks the notice read
    expect(now).toHaveLength(1)
    expect(now[0]).toMatchObject({ title: 'Mei passed you the baton', cta: 'Carry', action: { kind: 'open', to: '/leg/B1' }, unreadIds: ['n1'], deadline: { at: 30 * HOUR, label: 'Strands in' } })
    expect(updates).toEqual([])
  })

  it('offers a one-tap accept for a reservation, with the Quick and Global lapse deadline', () => {
    // #given Mei reserved the next leg of a Global baton for the runner
    const reserved = baton({ id: 'b2', holder: mei, recipientId: 'me', recipientReservedAt: 2 * HOUR })
    // #when
    const { now } = inboxSections(snapshot({ batons: [reserved] }), 'me')
    // #then
    expect(now[0]).toMatchObject({ cta: 'Accept', action: { kind: 'accept', batonId: 'b2', to: '/relay/B2' }, deadline: { at: 26 * HOUR, label: 'Lapses in' } })
  })

  it('warns while the crew streak is at risk, with its deadline', () => {
    // #given a running streak with no pass today
    const yours = crew({ id: 'c1', name: 'CT Humbs', members: [me, mei], streak: 6, todayHandoffs: 0, deadline: 20 * HOUR })
    // #when
    const { now } = inboxSections(snapshot({ crews: [yours] }), 'me')
    // #then
    expect(now[0]).toMatchObject({ title: 'CT Humbs needs a pass today', action: { kind: 'open', to: '/crew' }, deadline: { at: 20 * HOUR, label: 'Streak ends in' } })
  })

  it('keeps a secured crew out of needs you now', () => {
    const yours = crew({ id: 'c1', members: [me], streak: 6, todayHandoffs: 1 })
    expect(inboxSections(snapshot({ crews: [yours] }), 'me').now).toEqual([])
  })

  it('lists the rest as updates, newest first, each with its own action', () => {
    // #given a beaten ghost, a rivalry update and the Daily opening
    const inbox = [
      notification({ id: 'daily', type: 'daily_active', createdAt: 1 }),
      notification({ id: 'ghost', type: 'ghost_beaten', batonId: 'b3', runId: 'run-9', createdAt: 3, readAt: 4 }),
      notification({ id: 'rival', type: 'rival_update', createdAt: 2 }),
    ]
    // #when
    const { updates } = inboxSections(snapshot({ batons: [baton({ id: 'b3', holder: mei })], inbox }), 'me')
    // #then
    expect(updates.map(item => [item.key, item.cta, item.action])).toEqual([
      ['ghost', 'Race again', { kind: 'open', to: '/leg/practice?ghost=run-9&relay=B3' }],
      ['rival', 'See rivalry', { kind: 'open', to: '/rivals' }],
      ['daily', 'Ride', { kind: 'open', to: '/daily' }],
    ])
    expect(updates[0]?.unreadIds).toEqual([])
    expect(updates[1]?.unreadIds).toEqual(['rival'])
  })
})
