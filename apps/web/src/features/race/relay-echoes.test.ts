import { describe, expect, it } from 'vitest'
import type { RelayEcho, RelayEchoKind } from '@nim-relay/shared'
import { echoLabel, legEchoes, MAX_TRACK_ECHOES, trackEchoes } from './relay-echoes'

function echo(kind: RelayEchoKind, dist: number | null, overrides: Partial<RelayEcho> = {}): RelayEcho {
  return { id: `${kind}-${dist ?? 'leg'}`, batonId: 'baton-1', kind, runner: { id: 'p-ada', name: 'Ada' }, leg: 12, runId: 'run-1', sector: 1, dist, at: 0, ...overrides }
}

describe('echoes on the track', () => {
  it('keeps only placed echoes, most meaningful first, four at most', () => {
    // #given one placed echo of every kind, newest first as the server sends them, and one that spans the leg
    const echoes = [echo('near-miss-legend', 500), echo('milestone', 400), echo('rescue', 300), echo('risk-pioneer', 200), echo('ghost-record', 100), echo('ghost-record', null)]
    // #when the track picks its echoes
    const picked = trackEchoes(echoes)
    // #then the near-miss legend is the one left out
    expect({ kinds: picked.map(item => item.kind), cap: MAX_TRACK_ECHOES }).toEqual({ kinds: ['ghost-record', 'risk-pioneer', 'rescue', 'milestone'], cap: 4 })
  })

  it('names the echoes that span the leg in the same order', () => {
    // #given echoes spanning the leg and one placed on it
    const echoes = [echo('near-miss-legend', null), echo('risk-pioneer', 200), echo('milestone', null), echo('ghost-record', null)]
    // #when the arrival picks its echoes
    const picked = legEchoes(echoes)
    // #then only the spanning ones come, most meaningful first
    expect(picked.map(item => item.kind)).toEqual(['ghost-record', 'milestone', 'near-miss-legend'])
  })
})

describe('echo labels', () => {
  it.each<[string, RelayEcho, string]>([
    ['a record with its time', echo('ghost-record', null, { runner: { id: 'p-tim', name: 'Tim' }, timeMs: 38_420 }), 'GHOST RECORD · TIM 38.42s'],
    ['a record left before times were kept', echo('ghost-record', null, { runner: { id: 'p-tim', name: 'Tim' } }), 'GHOST RECORD · TIM'],
    ['a risk pioneer', echo('risk-pioneer', 200), 'RISK PIONEER · ADA'],
    ['a near-miss legend', echo('near-miss-legend', null, { runner: { id: 'p-yuki', name: 'Yuki' } }), 'NEAR-MISS LEGEND · YUKI'],
    ['a rescue', echo('rescue', null, { runner: { id: 'p-marco', name: 'Marco' } }), 'RESCUE · MARCO'],
    ['a milestone, by its handoff', echo('milestone', null, { leg: 50 }), 'HANDOFF 50'],
  ])('reads %s', (_case, input, label) => {
    expect(echoLabel(input)).toBe(label)
  })
})
