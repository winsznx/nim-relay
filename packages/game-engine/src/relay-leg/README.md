# Relay Leg (engine v5)

A deterministic 60 Hz hoverboard leg: carry the baton ~1.5-1.75 km through gates, hazards, one fork and one pulse section, then hand off. The simulation is authoritative. The Three.js client, the ghost and the Worker's `replay()` all run the same `step()`.

## Contract

- `types.ts` is the shared contract. Renderers read `State` and `Track`, never write them.
- `buildTrack(config)` composes the route from authored modules (`modules.ts`) with a seeded PRNG.
- `createState(config)` validates the config (`RangeError` on bad version, seed, world, tier or `openingFlow` outside `0..MAX_OPENING_FLOW`) and returns tick 0.
- `step(state, input)` returns a new state and never mutates its argument. A finished state is returned as is.
- `validateTrace(value)` never throws. It returns `{ ok: true, trace }` or `{ ok: false, error: { code, index } }` with codes `count`, `shape`, `order`, `after-end`, `input` and `size`.
- `InputCursor.at(tick)` holds steer until the next sample. Actions fire only on their sample's tick.
- `replay({ ...config, inputTrace })` is server verification. `finalize(state, trace)` gives the client the same `Result` from its live state, so equal hashes mean the run verified.

Additions to the original contract: `Fork.safeHalfWidth`, `Fork.riskHalfWidth` and `Gate.period`, plus the `State` fields `airTicks`, `airCleared`, `riskClean`, `bufferedAction` and `bufferTicks`.

## Units

| Quantity | Unit |
| --- | --- |
| `dist`, `x`, `y`, widths, heights | Q16.16 metres (`ONE` = 1 m) |
| `speed`, `vy`, gust `amplitude` | Q16.16 metres per tick |
| `flow` | Q16.16 fraction, `ONE` = full FLOW |
| `period`, `phase`, timers | ticks (60 per second) |
| `Segment.bend` | milli-radians per 100 m, presentation only |

Time-based rules (movers, doors, trains, pulse lanes, the beat) resolve against the tick of the state `step` returns, so a renderer drawing `state` should pass `state.tick` to `hazardLateral`, `doorOpenSide`, `trainBlockedSide`, `pulseGateLateral` and `onBeat`.

The beat is `PULSE_PERIOD` = 25 ticks, which is exactly 144 BPM at 60 Hz. Beat 0 is tick 0 of every leg and no route adds a phase, so music time-stretched to 144 BPM stays locked to the simulation. `onBeat(track, tick)` is true for the first `PULSE_WINDOW` (8) ticks of each beat, for music and visual sync. `onBeat(track, tick, dist)` also requires being inside the pulse section, which is what boost pads use.

## Rules worth knowing

- Steering is a target position: `x` closes 1/6 of the gap to `steer * halfWidth / 64` each tick, plus any gust push.
- Speed eases towards `BASE_SPEED + flow * FLOW_SPEED`, plus rail and boost-pad bonuses. A hit or fall pins speed at `STUMBLE_SPEED` while stumbling.
- Hazards and gaps are ignored while stumbling, so one mistake costs one penalty.
- Landing inside a gap counts as a fall, the same as crossing its edge on the ground.
- Clean landings only pay FLOW when the air came from a ramp or cleared a hazard or gap, so hopping on flat ground earns nothing.
- A jump or slide pressed while it can't fire waits up to `ACTION_BUFFER_TICKS`.
- `RISK_CLEAR` needs the whole risk path without a hit or a fall.
- Pulse gates have two lanes, `x` and `-x`. `pulseGateLateral(gate, tick)` lights `x` when `floor(tick / 25)` is even and `-x` when it's odd, so exactly one lane is lit at every tick. Crossing within `half` of the lit lane is a `PULSE_HIT` (also a `PERFECT_GATE`, +9% FLOW). Anything else is a `MISSED_GATE`, the centre line included. Reading the beat and arriving in the right lane is the skill.

## Determinism

The same rules as the other engines apply here. Outcome math is integer only, with Q16.16 from `../fixed-point`. Randomness comes only from `seedState`/`splitmix64`, and hashing from `sha256`/`canonicalJSON`. There is no `Math.random`, `Date`, `performance`, float state, trigonometry or DOM. Integer divisions truncate with `Math.trunc`. `RULES_HASH` is the SHA-256 of `RULES`, a string built from the simulation's tuning constants and the beat, so any retune changes it. Route content is bound through the track inside every result hash. `sim.test.ts` asserts that every number in a finished state, including the track, is a safe integer.

`corpus.test.ts` replays 200 legs (40 per world, mixed tiers, opening FLOW and bot styles) against `golden.json` in Node and in an isolated workerd (`tests/parity/vitest.config.mts`). If you change a rule or a module on purpose, regenerate the golden file with `pnpm --filter @nim-relay/game-engine exec tsx tests/relay-leg-corpus/generate.ts` and call it out in review, because every previously verified hash changes with it.

## Adding a module

1. Author it in `modules.ts` with integer authoring units: metres along the module, lateral `x` as a percent of the path half-width, widths in decimetres. Prefer an existing shape (`straight`, `curve`, `climb`, `drop`, `rampRun`, `railRun`, `corridor`, `padRun`, `gustCurve`) with world-specific hazard slots. Write a new shape only for a new rhythm.
2. Follow the layout rules at the top of `modules.ts`. Keep hazards 30 m apart when tier 0 sees them. Put a ramp 4-10 m before every gap. Leave nothing collidable for 50 m after a ramp (90 m for beams), and nothing you would jump within 50 m before one. Put the gates around a lane hazard in the opposite lane. Put pulse gates at 35-60% of the half-width, at least 1.5 beats of base-speed travel apart, with no hazard or gust zone within 25 m.
3. Give it a difficulty from 1 to 3 and add it to the world's `pool`. Ids are `${world}.${kind}.${variant}`, and renderers key kit pieces off them.
4. Run `pnpm --filter @nim-relay/game-engine test`. `content.test.ts` checks the invariants across 500 seeds × worlds × tiers, and `sim.test.ts` checks that the test bots still finish. Then regenerate `golden.json`.
