import { ONE, clamp } from '../fixed-point'
import { seedState, splitmix64 } from '../prng'
import { canonicalJSON, sha256 } from '../replay/hash'

export const MAX_TICKS = 5400
export const RULES_HASH = sha256('station-race-v4:60hz:boost-210:cool-290:overheat-120:jump-6100:gravity-330:track-100:actions-impulse')
export type World = 'coast' | 'alpine' | 'metro' | 'solar' | 'ocean'
export interface Config { engineVersion: '4'; challenge: 'station-race'; challengeVersion: '4'; seed: string; world: World }
export interface Input { steer: number; boost: 0 | 1; action: 0 | 1 | 2 }
export type Sample = readonly [number, number, 0 | 1, 0 | 1 | 2]
export type InputTrace = readonly Sample[]
export interface Zone { from: number; to: number; x: number; half: number }
export interface Hazard { dist: number; x: number; half: number; kind: 'barrier' | 'beam' | 'moving'; period: number }
export interface Track {
  finishDist: number; beatPeriod: number
  chunks: { from: number; to: number; kind: string; elevation: number }[]
  gates: { dist: number; x: number; half: number; kind: 'gold' | 'beat' }[]
  hazards: Hazard[]; boostZones: Zone[]; rails: Zone[]; gaps: Zone[]; ramps: Zone[]
  shortcut: { from: number; to: number; side: -1 | 1 }
}
export interface Metrics { hazardsHit: number; nearMisses: number; gates: number; missedGates: number; beatHits: number; boostTicks: number; overheats: number; jumps: number; landings: number; grindTicks: number; shortcutTicks: number }
export interface State {
  config: Readonly<Config>; track: Readonly<Track>; tick: number; dist: number; x: number; y: number; vy: number; speed: number; heat: number
  boosting: 0 | 1; grinding: 0 | 1; duckTicks: number; stumbleTicks: number; overheatTicks: number; groundHeight: number
  finished: 0 | 1; gateIdx: number; hazardIdx: number; metrics: Readonly<Metrics>
}
const Q = (n: number): number => n * ONE
export function buildTrack(seed: string, world: World = 'coast'): Track {
  let rng = seedState(`${seed}:${world}:station-v4`)
  const next = (): number => { const r = splitmix64(rng); rng = r.state; return Number(r.value % 65536n) }
  const chunks = ['departure', 'boulevard', 'skybridge', 'switchback', 'shortcut', 'rhythm', 'grind', 'storm', 'skyline', 'launch'].map((kind, i) => ({ from: Q(i * 10), to: Q((i + 1) * 10), kind, elevation: Q([0, 0, 2, 4, 4, 2, 3, 1, 2, 0][i]!) }))
  const gates: Track['gates'] = []
  for (let i = 0; i < 32; i++) gates.push({ dist: Q(4 + i * 3), x: (i % 2 ? 1 : -1) * (12000 + next() % 14000), half: 26000, kind: i >= 15 && i <= 20 ? 'beat' : 'gold' })
  const hazards: Hazard[] = [18, 28, 37, 47, 63, 72, 82, 89].map((d, i) => ({ dist: Q(d), x: i % 3 === 0 ? 0 : (i % 2 ? -29000 : 29000), half: i % 3 === 0 ? 56000 : 17000, kind: i % 3 === 0 ? 'beam' : i % 3 === 1 ? 'barrier' : 'moving', period: 150 + next() % 90 }))
  const zone = (from: number, to: number, x = 0, half = ONE): Zone => ({ from: Q(from), to: Q(to), x, half })
  return { finishDist: Q(100), beatPeriod: 30, chunks, gates, hazards, boostZones: [zone(9, 15, -24000, 24000), zone(50, 60, 0, 42000), zone(91, 97, 0, 32000)], rails: [zone(64, 70, 47000, 12000)], gaps: [zone(24, 26), zone(78, 80)], ramps: [zone(22, 24), zone(76, 78)], shortcut: { from: Q(40), to: Q(49), side: next() % 2 ? 1 : -1 } }
}
export function groundAt(track: Readonly<Track>, dist: number): number {
  const index = Math.min(track.chunks.length - 1, Math.max(0, Math.floor(dist / Q(10))))
  const chunk = track.chunks[index]!
  const next = track.chunks[index + 1] ?? chunk
  return chunk.elevation + Math.trunc((next.elevation - chunk.elevation) * (dist - chunk.from) / Q(10))
}
export function hazardX(hazard: Hazard, tick: number): number {
  if (hazard.kind !== 'moving') return hazard.x
  const phase = tick % hazard.period
  const triangle = phase * 2 < hazard.period ? phase * 2 : (hazard.period - phase) * 2
  return Math.trunc(triangle * 90000 / hazard.period) - 45000
}
export function validateConfig(config: Config): void {
  if (config.engineVersion !== '4' || config.challengeVersion !== '4' || config.challenge !== 'station-race') throw new RangeError('Station race version must be 4')
  if (typeof config.seed !== 'string' || !config.seed.length || config.seed.length > 128) throw new RangeError('Invalid seed')
  if (!['coast', 'alpine', 'metro', 'solar', 'ocean'].includes(config.world)) throw new RangeError('Invalid world')
}
export function createState(config: Config): State {
  validateConfig(config)
  return { config: Object.freeze({ ...config }), track: buildTrack(config.seed, config.world), tick: 0, dist: 0, x: 0, y: 0, vy: 0, speed: 2100, heat: 0, boosting: 0, grinding: 0, duckTicks: 0, stumbleTicks: 0, overheatTicks: 0, groundHeight: 0, finished: 0, gateIdx: 0, hazardIdx: 0, metrics: { hazardsHit: 0, nearMisses: 0, gates: 0, missedGates: 0, beatHits: 0, boostTicks: 0, overheats: 0, jumps: 0, landings: 0, grindTicks: 0, shortcutTicks: 0 } }
}
function validInput(input: Input): boolean { return Number.isInteger(input.steer) && input.steer >= -64 && input.steer <= 64 && (input.boost === 0 || input.boost === 1) && (input.action === 0 || input.action === 1 || input.action === 2) }
export function step(state: State, input: Input): State {
  if (!validInput(input)) throw new RangeError('Invalid station input')
  if (state.finished) return state
  const m: Metrics = { ...state.metrics }
  const x = clamp(state.x + Math.trunc((input.steer * 1024 - state.x) / 7), -ONE, ONE)
  let { y, vy, heat, speed, gateIdx, hazardIdx } = state
  let overheatTicks = Math.max(0, state.overheatTicks - 1)
  let stumbleTicks = Math.max(0, state.stumbleTicks - 1)
  let duckTicks = Math.max(0, state.duckTicks - 1)
  if (input.action === 1 && y === 0 && stumbleTicks === 0) { vy = 6100; duckTicks = 0; m.jumps++ }
  if (input.action === 2 && y === 0) duckTicks = 36
  if (y > 0 || vy > 0) { y = Math.max(0, y + vy); vy -= 330; if (y === 0) { vy = 0; m.landings++ } }
  let boosting: 0 | 1 = input.boost && !overheatTicks && !stumbleTicks ? 1 : 0
  heat = clamp(heat + (boosting ? 210 : -290))
  if (heat === ONE) { overheatTicks = 120; boosting = 0; m.overheats++ }
  if (boosting) m.boostTicks++
  const inZone = (z: Zone): boolean => state.dist >= z.from && state.dist < z.to && Math.abs(x - z.x) <= z.half
  const rhythm = state.dist >= Q(50) && state.dist < Q(60)
  const onBeat = state.tick % state.track.beatPeriod < 8
  const boostLane = state.track.boostZones.some(inZone) && (!rhythm || onBeat)
  const grinding: 0 | 1 = state.track.rails.some(inZone) && y < 16000 ? 1 : 0
  if (grinding) { m.grindTicks++; heat = Math.max(0, heat - 100) }
  const shortcut = state.dist >= state.track.shortcut.from && state.dist < state.track.shortcut.to && x * state.track.shortcut.side > 28000
  if (shortcut) m.shortcutTicks++
  const target = stumbleTicks ? 800 : overheatTicks ? 1300 : 2100 + (boosting ? 1500 : 0) + (boostLane ? 700 : 0) + (grinding ? 600 : 0) + (shortcut ? 900 : 0)
  speed += Math.trunc((target - speed) / 8)
  const dist = Math.min(state.track.finishDist, state.dist + speed)
  const hit = (): void => { m.hazardsHit++; stumbleTicks = 54; speed = 700 }
  while (hazardIdx < state.track.hazards.length && state.track.hazards[hazardIdx]!.dist <= dist) {
    const h = state.track.hazards[hazardIdx++]!
    const err = Math.abs(x - hazardX(h, state.tick))
    const avoided = h.kind === 'beam' ? duckTicks > 0 : y > 24000
    if (err <= h.half && !avoided) hit()
    else if (err <= h.half + 10000) m.nearMisses++
  }
  for (const ramp of state.track.ramps) if (state.dist < ramp.to && dist >= ramp.to && Math.abs(x - ramp.x) <= ramp.half && y === 0) { y = 1; vy = 6700; m.jumps++ }
  for (const gap of state.track.gaps) if (state.dist < gap.from && dist >= gap.from && Math.abs(x - gap.x) <= gap.half && y < 12000 && vy <= 0) hit()
  while (gateIdx < state.track.gates.length && state.track.gates[gateIdx]!.dist <= dist) {
    const gate = state.track.gates[gateIdx++]!
    if (Math.abs(x - gate.x) <= gate.half) { m.gates++; if (gate.kind === 'beat' && onBeat) { m.beatHits++; heat = Math.max(0, heat - 6000) } }
    else m.missedGates++
  }
  return { ...state, tick: state.tick + 1, dist, x, y, vy, speed, heat, boosting, grinding, overheatTicks, stumbleTicks, duckTicks, groundHeight: groundAt(state.track, dist), gateIdx, hazardIdx, finished: dist >= state.track.finishDist || state.tick + 1 >= MAX_TICKS ? 1 : 0, metrics: m }
}
export type TraceValidation = { ok: true; trace: InputTrace } | { ok: false; error: { code: string; index: number } }
export function validateTrace(value: unknown, maxTicks = MAX_TICKS): TraceValidation {
  const fail = (code: string, index = -1): TraceValidation => ({ ok: false, error: { code, index } })
  if (!Array.isArray(value) || !value.length || value.length > MAX_TICKS) return fail('count')
  const trace: Sample[] = []; let tick = 0; let bytes = 2
  for (let i = 0; i < value.length; i++) {
    const s: unknown = value[i]
    if (!Array.isArray(s) || s.length !== 4) return fail('shape', i)
    const [dt, steer, boost, action] = s as [unknown, unknown, unknown, unknown]
    if (typeof dt !== 'number' || !Number.isSafeInteger(dt) || (i === 0 ? dt !== 0 : dt <= 0)) return fail('order', i)
    tick += dt
    if (tick >= maxTicks) return fail('after-end', i)
    if (typeof steer !== 'number' || !Number.isInteger(steer) || steer < -64 || steer > 64 || (boost !== 0 && boost !== 1) || (action !== 0 && action !== 1 && action !== 2)) return fail('input', i)
    bytes += JSON.stringify(s).length + 1
    if (bytes > 65536) return fail('size', i)
    trace.push([dt, steer, boost, action])
  }
  return { ok: true, trace }
}
export class InputCursor {
  private index = 0
  private sampleTick = 0
  constructor(private readonly trace: InputTrace) { const v = validateTrace(trace); if (!v.ok) throw new RangeError(v.error.code) }
  at(tick: number): Input {
    while (this.index + 1 < this.trace.length && this.sampleTick + this.trace[this.index + 1]![0] <= tick) { this.index++; this.sampleTick += this.trace[this.index]![0] }
    const sample = this.trace[this.index]!
    return { steer: sample[1], boost: sample[2], action: tick === this.sampleTick ? sample[3] : 0 }
  }
}
export interface Result { resultHash: string; ticks: number; timeMs: number; completed: boolean; score: number; metrics: Readonly<Metrics> }
export function finalize(state: State, inputTrace: InputTrace): Result {
  if (!state.finished) throw new RangeError('Race not finished')
  const validation = validateTrace(inputTrace, state.tick)
  if (!validation.ok) throw new RangeError(validation.error.code)
  const completed = state.dist >= state.track.finishDist
  const score = completed ? Math.max(0, 100000 - state.tick * 10 + state.metrics.gates * 100 + state.metrics.beatHits * 200 - state.metrics.hazardsHit * 150) : 0
  return { resultHash: sha256(canonicalJSON({ rules: RULES_HASH, state, inputTrace })), ticks: state.tick, timeMs: Math.trunc(state.tick * 1000 / 60), completed, score, metrics: state.metrics }
}
export function replay(config: Config & { inputTrace: InputTrace }): Result {
  const validation = validateTrace(config.inputTrace)
  if (!validation.ok) throw new RangeError(validation.error.code)
  const cursor = new InputCursor(validation.trace)
  const { inputTrace: _trace, ...raceConfig } = config
  void _trace
  let state = createState(raceConfig)
  while (!state.finished) state = step(state, cursor.at(state.tick))
  return finalize(state, validation.trace)
}
