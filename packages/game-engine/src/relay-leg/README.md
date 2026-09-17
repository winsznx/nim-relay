# Relay Leg (engine v6)

A deterministic 60 Hz hoverboard leg on a lane-based road: carry the baton 1.6-1.8 km through gates, hazards, world events, two forks and a pulse section, then hand off. The simulation is authoritative. The Three.js client, the ghost and the Worker's `replay()` all run the same `step()`. v5 is frozen in `../relay-leg-v5` so verified v5 runs replay forever.

## Contract

- `types.ts` is the shared contract. Renderers read `State` and `Track`, never write them.
- `buildTrack(config)` composes the route from authored modules (`modules.ts`, vocabulary in `module-shapes.ts`) with a seeded PRNG. Modules are mirrored left to right at random.
- `createState(config)` validates the config (`RangeError` on bad version, seed, world, tier, `openingFlow`, `tetherSaves` or ghostline) and returns tick 0.
- `step(state, input)` returns a new state and never mutates its argument. A finished state is returned as is.
- `validateTrace(value)` never throws. Samples are `[dt, shift, nudge, action]`; error codes are `count`, `shape`, `order`, `after-end`, `input` and `size`.
- `InputCursor.at(tick)` holds nudge until the next sample. Shift and action fire only on their sample's tick.
- `replay({ ...config, inputTrace })` is server verification. `finalize(state, trace)` gives the client the same `Result` from its live state, so equal hashes mean the run verified.
- `deriveGhostline(config, trace)` turns a verified run into the next runner's `Ghostline`. Pass the config that run was verified against, its own ghostline included: drafting changes FLOW, so the route depends on it.

Additions to the contract in `types.ts`: `State.ghostAhead` (overtake hysteresis latch).

## Helpers for renderers and the Worker

| Helper | Returns |
| --- | --- |
| `laneSlots(count)` | lane slots left to right, e.g. `[-2, 0, 2]` |
| `laneCenterX(slot, laneWidth = LANE_WIDTH)` | lane centre, Q16.16 m |
| `laneLayoutAt(track, dist, path)` | `{ count, width, shoulder, leftEdge, rightEdge, halfWidth }` |
| `activePathAt(track, dist, plannedPath)` | `plannedPath` inside a fork, else `'main'` |
| `forkAt(track, dist)` | the fork whose span contains `dist`, or null |
| `pathOffsetAt(track, dist, path)` | presentation: a fork path's centre line offset from the main centre line (Q16.16 m); `x + pathOffsetAt` is continuous across the split and the rejoin |
| `hazardLaneAt(hazard, tick, laneWidth = LANE_WIDTH)` | a hazard's lateral centre (Q16.16 m); movers swing between `lanes[0]` and `lanes[1]` |
| `pulseGateLane(gate, tick)` | the lit lane slot of a gate |
| `eventState(event, state)` | `{ phase, progress, collision, x, half, lanes, push }`, see below |
| `checkpointBefore(track, dist, path)` | where a tether save respawns a courier that fell at `dist` |
| `onBeat(track, tick, dist?)` | beat window, optionally inside the pulse section |
| `ghostlineAt(ghostline, dist)` | `{ x, path, tick }` of the ghost at `dist`, or null past its line |
| `halfWidthAt`, `segmentAt`, `groundAt` | road half-width, segment and ground height at `dist` |

Time-based truth resolves against the tick of the state `step` returns, so a renderer drawing `state` passes `state.tick`.

## Units

| Quantity | Unit |
| --- | --- |
| `dist`, `x`, `y`, widths, heights | Q16.16 metres (`ONE` = 1 m) |
| `speed`, `vx`, `vy` | Q16.16 metres per tick |
| `flow` | Q16.16 fraction, `ONE` = full FLOW |
| gust and crosswind `amplitude` | signed millimetres per tick, + pushes right |
| rising-bridge and bridge-break `amplitude` | launch speed threshold, millimetres per tick |
| `period`, `phase`, `duration`, timers | ticks (60 per second) |
| `Ghostline.x` | centimetres from that path's centre line |
| `Segment.bend` | milli-radians per 100 m, presentation only |

## Rules worth knowing

### Lanes

- A path of N lanes uses slots in half-lane units: `[0]`, `[-1, 1]`, `[-2, 0, 2]`, `[-3, -1, 1, 3]`. The main road is 3 lanes of 3.0 m with 0.9 m shoulders; forks split it into a 2-lane safe path and a 1-lane risk path. Inside a fork, `Segment.laneCount` and edges describe the safe path.
- `shift` retargets one slot from `targetLane`. From an outer lane it targets the shoulder, slot `±count`, 0.6 m past the lane edge. From the shoulder it targets past the road edge, slot `±(count + 1)`. Shifting inward from either goes back to the outer lane.
- Lateral motion is a discrete critically damped spring (`k = (1 - r)^2`, `c = 1 - r^2`, pole `r` 68% at base speed to 64% at full FLOW speed) toward the slot's target plus `nudge * 5 cm` plus the wind. A 3 m lane change settles in 14-16 ticks. The lane is acquired (`LANE_ACQUIRED`) within 8 cm of the target at under 2 cm/tick, so a courier never floats between lanes.
- A clean lane change (real lane to real lane, no stumble, not on the shoulder) pays 1% FLOW, budgeted to one paid change per 60 ticks on average.

### Edges, falls and the tether

- Past the outer lane edge is the shoulder: `SHOULDER` on entry, speed drag, FLOW drain.
- `rail`: reaching the road edge starts a grind (`EDGE_GRIND`, motion `grinding`, pinned at `halfWidth`). A contact at 15 cm/tick or more is a hard impact (-12% FLOW), softer contact costs 6%. Shift or nudge inward inside the window (55/40/32 ticks by tier) for `EDGE_SAVE` (+6%); shift outward or let the window run out and the courier goes over.
- `open`: past the edge is a fall. `wall`: the courier bounces back toward its outer lane with a short stumble and -3% FLOW; `EDGE_GRIND` fires as the contact cue but motion stays `riding`.
- A fall (`FALL`, -45% FLOW, Relay Rush over) freezes `dist` for 66 ticks while `y` drops. Then a tether save (`TETHER_SAVE`, motion `tethering` for 54 ticks while `y` returns to the deck) respawns the courier at `checkpointBefore` at 60% base speed with FLOW halved again. Without a save the leg fails (`LEG_FAILED`, `result.failed`, score 0). The clock runs throughout.
- Checkpoints sit at every module start and every fork path start. Speed-gated risk paths get none, so missing a relay cut pulls the courier back before the fork, where it can choose again.
- After a respawn hazards re-arm; gates already scored stay scored.

### Hazards and world events

- Obstacles block lane slots. A blocked lane hits within `laneWidth / 2 - 30 cm` of its centre; adjacent blocked lanes merge, and blocking every lane closes the shoulders too. Low obstacles clear at 0.9 m (jump), overhead ones by sliding. A hit costs 30% FLOW, a 48-tick stumble and a lateral shove toward the nearest free lane. Past a line obstacle the courier keeps its target lane; a lane closure knocks it into the free lane for good. Hits are ignored while stumbling.
- Passing within 50 cm of a blocked area, or clearing it by jump or slide, is a `NEAR_MISS` (+4%).
- World events trigger when route distance reaches `triggerDist` (`EVENT_TRIGGERED`, `eventTicks[id]`), so every courier gets the same telegraph distance. `eventState` phases:

| Kind | telegraph | active | settled | Collision |
| --- | --- | --- | --- | --- |
| `lane-closure` | barriers slide in (`duration`) | lanes closed over `[dist, dist + length)` | never | low, over the span |
| `maintenance-drone` | 40 ticks in `lanes[0]` | drifts to `lanes[1]` by `duration` | parked | low, 2.1 m half-extent |
| `transit-crossing` | 50 ticks of signals | crosses `lanes[0]` to `lanes[1]` by `duration` | gone | low while active, 3.0 m half-length |
| `crosswind` | push builds over `duration` | blows 3/5 of `period`, lulls 2/5 | never | none, pushes over the span |
| `collapsing-gantry` | sags over `lanes` for `duration` | falls for 18 ticks | debris | overhead, then crush, then low |
| `drone-pattern` | drones descend over `duration` | `count` drones step one lane back and forth every `period` | never | overhead |
| `rising-bridge`, `bridge-break` | deck rises or breaks over `duration` | ramp live | never | none; gates the ramp |
| `pulse-tunnel` | lights warm up over `duration` | beat lighting | never | none |

- A ramp inside a rising-bridge or bridge-break span launches only at or above the event's speed threshold (~1.5 s of air); below it the deck gives way after a short hop and the gap takes the courier.

### Forks

- At `fork.from` the lane nearest `x` picks the path: slots on the risk side of centre take the risk path. Lanes carry straight across (main right lane becomes the risk lane, the other two the safe lanes) and merge back the same way at `fork.to`.
- The risk path progresses at `riskProgress`. Leaving it without a hit or fall pays `RISK_CLEAR` (+12%). On a relay cut, carrying the gap pays `RISK_CLEAR` with +15% and a `relay-cut` moment the moment the courier is across.

### Gates, FLOW and Relay Rush

- A gold gate passed in its lane pays +4%; any other lane is `MISSED_GATE` (-4%). Pulse gates light `lane` on even beats and `-lane` on odd beats from tick 0 (25-tick beat, 144 BPM): the lit lane pays `PULSE_HIT` +8%.
- FLOW decays ~1.5% per second. Reaching full FLOW (`FLOW_MAX`) starts Relay Rush (`RUSH_START`): 240 ticks of +8 cm/tick, no decay, FLOW pinned at full. A hit or fall ends it on the spot; running out drops FLOW to 70%.
- Speed eases toward `0.46 + flow * 0.30 m/tick`, plus rush, rail and pad bonuses, minus shoulder and grind drag.

### Ghost

- `ghostLeadTicks = state.tick - (tick the ghost passed this distance)`: positive while the ghost is ahead. Where the ghost never got to, the courier is ahead.
- `GHOST_OVERTAKEN` fires once the ghost leads by 15 ticks; `GHOST_OVERTAKE` fires when that lead falls to zero (+4%, `ghost-overtake` moment the first time). The `ghostAhead` latch between them stops level running from farming overtakes.
- `DRAFTING`: same path, within 45 cm of the ghost's line, ghost 1-90 ticks ahead; pays ~2.4% FLOW per second.

### Moments and score

- Moments (`edge-save`, `relay-cut`, `rush`, `ghost-overtake`, `tether-save`) are kept in route order, at most 8, never the same kind twice at one distance.
- Score: `300000 - ticks*40 + gates*120 + pulse*160 + near*60 + landings*40 + risk*400 + saves*200 + overtakes*150 + rushes*300 - hits*300 - falls*500 - hard*100 + avgflow*2000`. Time dominates. Failed and unfinished legs score 0.

## Determinism

Outcome math is integer only, with Q16.16 from `../fixed-point`. Randomness comes only from `seedState`/`splitmix64`, hashing from `sha256`/`canonicalJSON`. There is no `Math.random`, `Date`, float state or trigonometry. `RULES_HASH` is the SHA-256 of `RULES`, built from every tuning constant, so any retune changes it. `sim.test.ts` asserts every number in finished legs is a safe integer.

`corpus.test.ts` replays 200 legs (40 per world, mixed tiers, opening FLOW, styles, ghostlines and tether saves) against `golden.json` in Node and in an isolated workerd (`tests/parity/vitest.config.mts`). After an intentional rule or content change, regenerate it with `pnpm --filter @nim-relay/game-engine exec tsx tests/relay-leg-corpus/generate.ts` and call it out in review: every verified hash changes.

## Adding a module

1. Author it in `modules.ts` with the builders in `module-shapes.ts`: metres along the module, lanes as slots, widths in decimetres. Prefer an existing shape with world-specific hazard slots.
2. Follow the layout rules at the top of `module-shapes.ts`: leave a free lane (or a hurdle to jump or a beam to slide), ramp every gap 4-10 m before it, keep ramp air time clear, put gates in free lanes, keep lane closures off the centre lane and the first 12 m of the module clear.
3. Give it a difficulty from 1 to 3 and add it to the world's `pool`. Ids are `${world}.${kind}.${variant}`.
4. Run `pnpm --filter @nim-relay/game-engine test`. `content.test.ts` checks the invariants across 500 seeds × worlds × tiers and `sim.test.ts` checks the bots still finish on time. Then regenerate `golden.json`.
