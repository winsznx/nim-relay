import { ONE, relayLeg } from '@nim-relay/game-engine'
import type { RaceConfig, RelayLegV6Config, RelayLegV6Sample, RelayLegV6Trace } from '@nim-relay/shared'

/**
 * Deterministic v6 couriers for tests. They read the course by playing it ahead with the engine itself, so they need
 * no knowledge of hazards or world events. Results always come from the server's replay, never from here.
 */

export type ForkPlan = 'safe' | 'risk'

type Input = relayLeg.Input
type State = relayLeg.State

const { EVENT } = relayLeg
/** Anything that costs the courier: a hit, a fall, a failed leg, or scraping or leaving the road edge. */
const TROUBLE = EVENT.HIT | EVENT.FALL | EVENT.LEG_FAILED | EVENT.EDGE_GRIND | EVENT.SHOULDER
const FALLING = EVENT.FALL | EVENT.LEG_FAILED

const LOOKAHEAD_TICKS = 90
/** A lane change is tried once trouble is this close; a jump or slide once it is closer still. */
const SHIFT_WINDOW_TICKS = 60
const ACTION_WINDOW_TICKS = 30
/** A dodge counts as clean when it rides this far past the trouble it avoids without new trouble, and never falls. */
const CLEAR_PAST_TICKS = 45
/** Metres before a fork where the courier lines up for its chosen side. */
const FORK_APPROACH = 90 * ONE
/** The failing courier shifts outward this often, faster than any grind window lets it recover. */
const EDGE_DIVE_TICKS = 20

const IDLE: Input = { shift: 0, nudge: 0, action: 0 }
const SHIFTS: readonly Input[] = [
  { shift: -1, nudge: 0, action: 0 },
  { shift: 1, nudge: 0, action: 0 },
]
const ACTIONS: readonly Input[] = [
  { shift: 0, nudge: 0, action: relayLeg.ACTION_JUMP },
  { shift: 0, nudge: 0, action: relayLeg.ACTION_SLIDE },
]

/** Bot traces by plan and config: several tests race the same course. */
const botTraces = new Map<string, RelayLegV6Trace>()

/**
 * The lookahead courier: rides its lane while the next LOOKAHEAD_TICKS stay clean, otherwise takes the lane change,
 * jump or slide that clears the trouble. With the risk plan it takes each fork's risk path that its own ride gets
 * through without a fall.
 */
export function botTrace(config: RaceConfig, plan: ForkPlan = 'safe'): RelayLegV6Trace {
  const key = `${plan}:${JSON.stringify(config)}`
  const cached = botTraces.get(key)
  if (cached) return cached
  const risked = new LookaheadCourier(v6Config(config), plan).ride()
  // A risk ride that still went wrong after its forks is replaced by the safe ride of the same course.
  const trace = plan === 'risk' && !finishesClean(config, risked) ? botTrace(config, 'safe') : risked
  botTraces.set(key, trace)
  return trace
}

/** The bot's trace, which must finish the leg without failing: tests that pass batons depend on it. */
export function finishingTrace(config: RaceConfig, plan: ForkPlan = 'safe'): RelayLegV6Trace {
  const trace = botTrace(config, plan)
  const { world, tier, seed } = v6Config(config)
  if (!finishesClean(config, trace)) throw new Error(`The ${plan} courier did not finish ${world} tier ${tier} (${seed})`)
  return trace
}

/** A courier who keeps shifting toward the right edge until it falls with no tether save left. */
export function failingTrace(config: RaceConfig): RelayLegV6Trace {
  const dive: Input = { shift: 1, nudge: relayLeg.NUDGE_RANGE, action: 0 }
  const trace = record(relayLeg.createState(v6Config(config)), state => (state.tick % EDGE_DIVE_TICKS === 0 ? dive : { ...IDLE, nudge: relayLeg.NUDGE_RANGE }))
  if (!relayLeg.replay({ ...v6Config(config), inputTrace: trace }).failed) throw new Error('The edge courier did not fail its leg')
  return trace
}

function finishesClean(config: RaceConfig, trace: RelayLegV6Trace): boolean {
  const result = relayLeg.replay({ ...v6Config(config), inputTrace: trace })
  return result.completed && !result.failed
}

export function v6Config(config: RaceConfig): RelayLegV6Config {
  if (config.engineVersion !== '6') throw new Error(`Expected a v6 relay leg, got engine ${config.engineVersion}`)
  return config
}

/** Plays `policy` to the end of the leg, sampling each tick where it shifts, acts or changes its nudge. */
function record(start: State, policy: (state: State) => Input): RelayLegV6Trace {
  let state = start
  const trace: RelayLegV6Sample[] = []
  let sampleTick = 0
  while (!state.finished) {
    const input = policy(state)
    const previous = trace.at(-1)
    if (!previous || input.shift !== 0 || input.action !== 0 || input.nudge !== previous[2]) {
      trace.push([state.tick - sampleTick, input.shift, input.nudge, input.action])
      sampleTick = state.tick
    }
    state = relayLeg.step(state, input)
  }
  return trace
}

class LookaheadCourier {
  /** States after 1, 2, ... idle ticks from the state the policy is deciding for. */
  private future: State[] = []

  constructor(
    private readonly config: RelayLegV6Config,
    private readonly plan: ForkPlan,
    /** Fork index -> the side this courier rides it on, decided when the fork comes into view. */
    private readonly sides = new Map<number, ForkPlan>(),
  ) {}

  ride(): RelayLegV6Trace {
    return record(relayLeg.createState(this.config), state => this.decide(state))
  }

  decide(state: State): Input {
    this.extendFuture(state)
    const lineUp = this.forkLineUp(state)
    if (lineUp && this.adopt(state, lineUp, LOOKAHEAD_TICKS)) return lineUp
    const trouble = firstEvent(this.future, TROUBLE)
    if (trouble < 0) return this.advance()
    const candidates = [...(trouble < SHIFT_WINDOW_TICKS ? SHIFTS : []), ...(trouble < ACTION_WINDOW_TICKS ? ACTIONS : [])]
    for (const dodge of candidates) {
      if (this.adopt(state, dodge, Math.min(LOOKAHEAD_TICKS, trouble + CLEAR_PAST_TICKS))) return dodge
    }
    return this.advance()
  }

  /** Rides idle one tick along the known future. */
  private advance(): Input {
    this.future.shift()
    return IDLE
  }

  private extendFuture(state: State): void {
    if (this.future.length === 0) this.future.push(relayLeg.step(state, IDLE))
    while (this.future.length < LOOKAHEAD_TICKS) {
      const last = this.future.at(-1)!
      if (last.finished) break
      this.future.push(relayLeg.step(last, IDLE))
    }
  }

  /** Takes `input` when its ride stays clean for `cleanTicks` and never falls within the lookahead, keeping that ride as the known future. */
  private adopt(state: State, input: Input, cleanTicks: number): boolean {
    const ride = rollout(state, input, LOOKAHEAD_TICKS)
    if (firstEvent(ride.slice(0, cleanTicks), TROUBLE) >= 0 || firstEvent(ride, FALLING) >= 0) return false
    this.future = ride.slice(1)
    return true
  }

  /** The shift toward the chosen side of the next fork while the courier is not on it yet. */
  private forkLineUp(state: State): Input | null {
    if (state.path !== 'main') return null
    const fork = state.track.forks.find(candidate => candidate.from > state.dist)
    if (!fork || fork.from - state.dist > FORK_APPROACH) return null
    const side = this.sideFor(state, fork)
    const onRiskSide = state.targetLane * fork.riskSide > 0
    if ((side === 'risk') === onRiskSide) return null
    return { shift: side === 'risk' ? fork.riskSide : fork.riskSide === 1 ? -1 : 1, nudge: 0, action: 0 }
  }

  private sideFor(state: State, fork: relayLeg.Fork): ForkPlan {
    const decided = this.sides.get(fork.index)
    if (decided) return decided
    const side: ForkPlan = this.plan === 'risk' && this.clearsRisk(state, fork) ? 'risk' : 'safe'
    this.sides.set(fork.index, side)
    return side
  }

  /**
   * Rides this courier's own policy through the fork on its risk side. Deterministic, so the real ride repeats it
   * exactly: the risk side is taken only when this ride gets through without a fall.
   */
  private clearsRisk(state: State, fork: relayLeg.Fork): boolean {
    const probe = new LookaheadCourier(this.config, 'safe', new Map([...this.sides, [fork.index, 'risk']]))
    let ahead = state
    while (!ahead.finished && ahead.dist < fork.to) {
      ahead = relayLeg.step(ahead, probe.decide(ahead))
      if (ahead.events & FALLING) return false
    }
    return ahead.forkChoices[fork.index] === 2
  }
}

/** The states after applying `input` once and then idling, up to `ticks` of them, stopping at the finish. */
function rollout(from: State, input: Input, ticks: number): State[] {
  const states: State[] = []
  let state = relayLeg.step(from, input)
  states.push(state)
  while (states.length < ticks && !state.finished) {
    state = relayLeg.step(state, IDLE)
    states.push(state)
  }
  return states
}

function firstEvent(states: readonly State[], mask: number): number {
  return states.findIndex(state => (state.events & mask) !== 0)
}
