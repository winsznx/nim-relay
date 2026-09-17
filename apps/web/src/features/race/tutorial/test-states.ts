import { relayLeg } from '@nim-relay/game-engine'
import { playBotLeg } from '../dev/bot'

/**
 * Engine states for the tutorial's unit tests: real tracks, with the courier placed anywhere on them. The lab's
 * default route (metro, seed dev-leg, tier 1) opens with a barrier in one lane at 150 m and a full-width barrier
 * at 205 m, and carries a beam over the centre and right lanes at 672 m.
 */

export const ONE = 65536

export function legConfig(overrides: Partial<relayLeg.Config> = {}): relayLeg.Config {
  return {
    engineVersion: relayLeg.ENGINE_VERSION,
    challenge: relayLeg.CHALLENGE,
    challengeVersion: relayLeg.ENGINE_VERSION,
    seed: 'dev-leg',
    world: 'metro',
    tier: 1,
    openingFlow: 0,
    tetherSaves: 1,
    ghostline: null,
    ...overrides,
  }
}

/** The lab's ghost, a quick starter on the safe routes, as the Ghostline on `config`. */
export function withGhostline(config: relayLeg.Config): relayLeg.Config {
  const ghostConfig: relayLeg.Config = { ...config, openingFlow: relayLeg.MAX_OPENING_FLOW, ghostline: null }
  const run = playBotLeg(ghostConfig, { fork: 'safe' })
  return { ...config, ghostline: relayLeg.deriveGhostline(ghostConfig, run.trace) }
}

/** A riding courier `metres` into the leg with the hazards before it resolved, then `overrides` applied. */
export function stateAt(config: relayLeg.Config, metres: number, overrides: Partial<relayLeg.State> = {}): relayLeg.State {
  const start = relayLeg.createState(config)
  const dist = Math.round(metres * ONE)
  const hazardIdx = start.track.hazards.findIndex(hazard => hazard.dist > dist)
  return { ...start, dist, hazardIdx: hazardIdx < 0 ? start.track.hazards.length : hazardIdx, ...overrides }
}

/** Lateral position (Q16.16 m) of lane `slot` at standard lane width. */
export function laneX(slot: number): number {
  return relayLeg.laneCenterX(slot, relayLeg.LANE_WIDTH)
}
