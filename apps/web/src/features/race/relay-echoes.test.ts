import { describe, expect, it } from 'vitest'
import type { RelayEcho, RelayEchoKind } from '@nim-relay/shared'
import { echoLabel, isSilhouetteEcho, legEchoes, MAX_TRACK_ECHOES, trackEchoes } from './relay-echoes'

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

  it('ranks the moments couriers left in motion above rescues and milestones', () => {
    // #given an edge save and a relay cut among older kinds of echo
    const echoes = [echo('milestone', 400), echo('edge-save', 350), echo('rescue', 300), echo('relay-cut', 250), echo('near-miss-legend', 200)]
    // #when the track picks its echoes
    const picked = trackEchoes(echoes)
    // #then the cut and the save stand, drawn as silhouettes
    expect(picked.map(item => item.kind)).toEqual(['relay-cut', 'edge-save', 'rescue', 'milestone'])
    expect(picked.map(item => isSilhouetteEcho(item.kind))).toEqual([true, true, false, false])
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
    ['an edge save', echo('edge-save', 300, { runner: { id: 'p-mariana', name: 'Mariana' } }), 'MARIANA’S SAVE'],
    ['a relay cut by a name ending in s', echo('relay-cut', 900, { runner: { id: 'p-marcus', name: 'Marcus' } }), 'MARCUS’ CUT'],
  ])('reads %s', (_case, input, label) => {
    expect(echoLabel(input)).toBe(label)
  })
})
