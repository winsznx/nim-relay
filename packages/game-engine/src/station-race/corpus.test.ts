import { describe, expect, it } from 'vitest'
import { createState, step, replay, finalize, InputCursor, validateTrace, MAX_TICKS, type Config, type Sample, type World } from './index'
import golden from './golden.json'
const worlds: World[] = ['coast', 'alpine', 'metro', 'solar', 'ocean']
describe('station v4 200-route replay corpus', () => {
  for (let i = 0; i < 200; i++) it(`route ${i}`, () => {
    expect(replay({engineVersion:'4',challenge:'station-race',challengeVersion:'4',seed:`golden-${i}`,world:worlds[i%5]!,inputTrace:[[0,i%129-64,0,0],[120,0,1,1],[180,32,0,2],[100,-32,1,0],[150,0,0,1]]}).resultHash).toBe(golden[i])
    const config: Config = { engineVersion: '4', challenge: 'station-race', challengeVersion: '4', seed: `station-corpus-${i}`, world: worlds[i % 5]! }
    let state = createState(config)
    const trace: Sample[] = []
    let last = 0
    while (!state.finished) {
      const tick = state.tick
      const input = { steer: (Math.floor(tick / (45 + i % 20)) * 17 + i * 11) % 129 - 64, boost: (tick + i * 13) % 490 < 260 ? 1 as const : 0 as const, action: tick % 160 === 0 ? 1 as const : tick % 91 === 0 ? 2 as const : 0 as const }
      const previous = trace.at(-1)
      if (!previous || input.steer !== previous[1] || input.boost !== previous[2] || input.action || tick - last >= 24) { trace.push([tick - last, input.steer, input.boost, input.action]); last = tick }
      state = step(state, input)
    }
    const result = replay({ ...config, inputTrace: trace })
    expect(result).toEqual(finalize(state, trace))
    expect(result.completed).toBe(true)
    expect(result.ticks).toBeGreaterThan(1800)
    expect(result.ticks).toBeLessThan(4200)
    expect(result.resultHash).toMatch(/^[a-f0-9]{64}$/)
  })
})
describe('station rules', () => {
  const config: Config = { engineVersion: '4', challenge: 'station-race', challengeVersion: '4', seed: 'rules', world: 'coast' }
  it('actions are impulses while boost and steer hold', () => {
    const cursor = new InputCursor([[0, 25, 1, 1], [4, -12, 0, 2]])
    expect(cursor.at(0)).toEqual({ steer: 25, boost: 1, action: 1 })
    expect(cursor.at(1)).toEqual({ steer: 25, boost: 1, action: 0 })
    expect(cursor.at(4).action).toBe(2)
    expect(cursor.at(5).action).toBe(0)
  })
  it('rejects exact upper boundary and malformed channels', () => {
    for (const trace of [[[0, 0, 0, 0], [MAX_TICKS, 0, 0, 0]], [[0, 65, 0, 0]], [[0, 0, 1, 3]], [[1, 0, 0, 0]], [[0, 0, 0, 0], [0, 0, 0, 0]]]) expect(validateTrace(trace).ok).toBe(false)
  })
  it('boost increases speed; holding too long overheats; release cools', () => {
    let hot = createState(config); let cool = createState(config)
    for (let i = 0; i < 120; i++) { hot = step(hot, { steer: 0, boost: 1, action: 0 }); cool = step(cool, { steer: 0, boost: 0, action: 0 }) }
    expect(hot.dist).toBeGreaterThan(cool.dist)
    for (let i = 0; i < 220; i++) hot = step(hot, { steer: 0, boost: 1, action: 0 })
    expect(hot.metrics.overheats).toBeGreaterThan(0)
    const heat = hot.heat
    for (let i = 0; i < 60; i++) hot = step(hot, { steer: 0, boost: 0, action: 0 })
    expect(hot.heat).toBeLessThan(heat)
  })
  it('binds world and rejects trailing samples after finish', () => {
    const trace: Sample[] = [[0, 0, 0, 0]]
    const a = replay({ ...config, inputTrace: trace })
    expect(replay({ ...config, world: 'solar', inputTrace: trace }).resultHash).not.toBe(a.resultHash)
    expect(() => replay({ ...config, inputTrace: [...trace, [a.ticks, 0, 0, 0]] })).toThrow()
  })
})
