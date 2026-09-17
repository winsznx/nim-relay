import { describe, expect, it } from 'vitest'
import { handoffCallout, missionCopy, quotedNote, type RaceMission } from './mission'

const mission: RaceMission = {
  batonName: 'Aurora',
  previous: { name: 'Mariana', timeMs: 44_120 },
  next: { name: 'Yasmine', context: null },
  note: null,
  route: null,
}

describe('mission copy', () => {
  it('names the delivery and the runner before you', () => {
    // #given a baton going from Mariana's leg to Yasmine
    // #when the mission header is written
    const copy = missionCopy(mission)
    // #then it reads as a delivery with the previous runner's time
    expect(copy).toEqual({ title: 'DELIVER AURORA TO YASMINE', previous: 'PREVIOUS RUNNER MARIANA · 44.12s', handoff: null, route: null })
  })

  it('keeps the baton moving when the handoff is open', () => {
    // #given the first leg of a sector with no chosen next runner
    // #when the mission header is written
    const copy = missionCopy({ ...mission, previous: null, next: null })
    // #then it asks to keep the baton moving and says the handoff is open
    expect(copy).toEqual({ title: 'KEEP AURORA MOVING', previous: null, handoff: 'OPEN HANDOFF AT FINISH', route: null })
  })

  it('names the Atlas route and says honestly when the leg has no Ghostline', () => {
    // #given a leg on a route the previous runner did not race
    const copy = missionCopy({ ...mission, route: { from: 'Cape Verdigris', to: 'Meridian Yard', ghost: 'different-route' } })
    // #then the route is named and the missing ghost explained
    expect({ route: copy.route, previous: copy.previous }).toEqual({ route: 'CAPE VERDIGRIS TO MERIDIAN YARD', previous: 'PREVIOUS RUNNER MARIANA RACED ANOTHER ROUTE · NO GHOSTLINE' })
  })

  it('adds where the next runner waits and drops an unknown previous time', () => {
    // #given a previous runner without a kept time and a next runner with context
    // #when the mission header is written
    const copy = missionCopy({ ...mission, previous: { name: 'Tim', timeMs: null }, next: { name: 'Yasmine', context: 'Waiting in Lisbon ' } })
    // #then both lines read cleanly
    expect({ previous: copy.previous, handoff: copy.handoff }).toEqual({ previous: 'PREVIOUS RUNNER TIM', handoff: 'WAITING IN LISBON' })
  })

  it('calls out the handoff only when someone is waiting', () => {
    // #given missions with and without a next runner
    // #then the gate callout names the recipient or stays quiet
    expect(handoffCallout(mission)).toBe('HANDOFF TO YASMINE')
    expect(handoffCallout({ ...mission, next: null })).toBeNull()
    expect(handoffCallout(null)).toBeNull()
  })

  it('quotes a note and ignores an empty one', () => {
    // #given a note with padding and an empty note
    // #then only the real note is quoted
    expect(quotedNote({ from: 'Tim', text: ' Keep it gold ' })).toBe('“Keep it gold”')
    expect(quotedNote({ from: 'Tim', text: '   ' })).toBeNull()
    expect(quotedNote(null)).toBeNull()
  })
})
