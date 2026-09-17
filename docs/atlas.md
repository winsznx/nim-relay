# Relay Atlas

The Relay Atlas turns the globe into a map of the game world. Batons travel between Relay Stations along routes, every route is a real relay-leg course, and the world lights up only where qualified legs have actually been raced.

Stations are game-world destinations. They are never where a player is. Nothing in the Atlas reads, stores or implies a runner's physical or network location, and the globe no longer places anything by country.

## Catalogue

`packages/shared/src/atlas.ts` holds the canonical, versioned catalogue that the Worker and the web app both import.

- 24 stations spread over every continent and ocean, from Genesis Station at 0°, 0° to Ice Shelf Relay and Polar Drift. Each station belongs to one playable world: coast, metro, alpine, solar or ocean.
- 55 directed routes. Genesis Station has one route into each world, and every other station has 2 to 4 routes out. Every station can be reached from Genesis and Genesis can be reached again.
- A route races the destination station's world at the route's tier, on a frozen seed `atlas-v1-<routeId>`. Every baton on a route races the same track, so a route's fastest run and ghost record compare like with like.
- Route ids and seeds never change. A new catalogue adds stations and routes under a new `ATLAS_VERSION`.

`packages/game-engine/src/relay-leg/atlas-routes.test.ts` builds the track of every route and has the engine's skilled courier ride it to a finish that the replay confirms. Engine v6 semantics and the golden corpus are unchanged: a route is only a choice of `seed`, `world` and `tier`, which the v6 config already carries.

## How a leg gets its route

1. A new baton starts on a route out of Genesis Station.
2. The holder races the baton's current route. The issued race carries `atlas` with the route and why the leg has a ghost or none.
3. After a qualified leg, and before the runner is chosen, the holder picks the next route (`BatonDetail.atlas.next`):
   - onward routes out of the station the leg reached, or
   - the same route again, so the next runner chases this runner's ghost.
   The holder can also leave it to the relay, which binds a deterministic default for that station and leg.
4. The chosen route is bound into the immutable handoff intent and into the NR1 commitment MAC next to the Relay Note. A prepared pass can't change its route, and preparing again with a different route is refused.
5. When the transfer verifies, the baton moves onto the bound route. The same route on its own course keeps the sector; any other route opens a new sector at that leg.

Mode rules live in `apps/worker/src/station/network/atlas.ts`:

| Mode | Route choice |
|------|--------------|
| Global, Crew, Rival | Every pass chooses |
| Quick | Only the pass that closes a round chooses. A round's opening pass keeps the route so both players race the same course |
| Daily | No baton and no choice |

The previous runner's ghost is offered only when they raced the same route. Otherwise the leg runs without a Ghostline and the race says so ("raced another route, no Ghostline").

## Verified aggregates

`state.atlas` in the network Durable Object is written only when a qualified handoff verifies, so reads never recompute history. Its size is bounded by the catalogue: one entry per route and station, and per runner at most every station and route once.

- Per route: verified runs, distinct qualified runners, fastest on-course run, latest ghost win, heat and last run. Heat adds 1 per qualified leg and halves every 3 days.
- Per station: qualified legs that left or reached it. A station with any is lit.
- Light the world: stations lit out of 24 and routes lit out of 55.
- Per runner: stations visited, routes completed, routes discovered (completed routes plus every route out of a visited station), baton journeys and Atlas missions.

Treasury grants and every other non-leg record never reach these aggregates.

Missions are defined in one module, `apps/worker/src/station/network/atlas-missions.ts`: EXPLORER (3 distinct routes), STATION HOPPER (5 stations), WORLD CARRIER (3 worlds), LAMPLIGHTER (first qualified leg on a dark route) and 25, 50 and 100 relay legs. Rewards are profile marks, never NIM.

## Existing batons and legs

State written before the Atlas is backfilled deterministically when it loads:

- a handoff is placed on the Genesis route into the world its run raced (`backfilled: true`, `onCourse: false`),
- a baton keeps its current course and is placed on the Genesis route into its world,
- the ledger is rebuilt from recorded handoffs, oldest first.

Backfilled legs count as verified runs and light their route, but they raced a different course and never set a route record. Verified results and their replays are untouched. Intents prepared before the Atlas keep the commitment they were signed with and move on to the relay's default route.

## API

Public reads, no private data, cached for 15 seconds:

- `GET /api/station/network/atlas`: catalogue version, route and station stats, light-the-world counts.
- `GET /api/station/network/atlas/routes/:routeId`: one route and its stats.

Also:

- `BatonDetail.atlas`: the journey (every verified leg, then the leg in progress), the current route and the next-route policy. Journeys may include a `treasury_starter_grant` entry, shown as "Starter baton from Genesis Station" and never counted as a handoff.
- `RunnerProfile.atlas`: progression and missions.
- `POST /network/handoff/prepare` accepts `routeId`.

## Web

- The globe draws every station and route in one draw call per layer; heat brightens routes, batons travel their real hops, and the low quality tier draws only the 24 hottest lit routes. Tap a route to open its sheet at `/atlas/route/:routeId`.
- World home shows the Light the world meter. Journeys gain an Atlas section with a scrubber and a replay that flies each hop on the globe.
- The handoff ceremony opens on the route step when the pass may choose.
- Profile shows Atlas progress and missions.
- `features/world/globe-bridge.ts` exports `playAtlasFlight({ from, to, kind })`, which resolves when the flight ends, or at once without a mounted globe or with reduced motion.
