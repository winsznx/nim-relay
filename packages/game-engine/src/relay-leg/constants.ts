import { ONE } from '../fixed-point'
import type { Tier } from './types'
import { centimetres, percent } from './units'

/**
 * Tuning constants for Relay Leg v6. Every value that changes the outcome of a
 * trace is part of RULES (result.ts), so a retune changes RULES_HASH.
 * Lengths and speeds are Q16.16 metres (per tick); FLOW amounts are Q16.16
 * fractions of full FLOW.
 */

// ---------------------------------------------------------------------------
// Road geometry
// ---------------------------------------------------------------------------

/** Standard lane and shoulder widths the modules author; the simulation reads widths from the track. */
export const LANE_WIDTH = centimetres(300)
export const SHOULDER_WIDTH = centimetres(90)
/** Shoulder mode steers to this far beyond the outer lane edge. */
export const SHOULDER_LINE = centimetres(60)
/** Shifting outward from the shoulder steers this far past the road edge. */
export const EDGE_OVERSHOOT = centimetres(60)
export const NUDGE_STEP = centimetres(5)

// ---------------------------------------------------------------------------
// Forward motion (m/tick). 0.46 m/tick is 27.6 m/s.
// ---------------------------------------------------------------------------

export const BASE_SPEED = centimetres(46)
export const FLOW_SPEED = centimetres(30)
export const RUSH_SPEED = centimetres(8)
export const STUMBLE_SPEED = centimetres(24)
export const RAIL_SPEED = centimetres(5)
export const PAD_SPEED = centimetres(20)
export const SHOULDER_DRAG = centimetres(12)
export const GRIND_DRAG = centimetres(16)
/** Speed after a tether respawn: 60% of base. */
export const RESPAWN_SPEED = Math.trunc(BASE_SPEED * 60 / 100)
/** Speed closes 1/16 of the gap to its target each tick. */
export const SPEED_SMOOTHING = 16

// ---------------------------------------------------------------------------
// Lateral motion: a discrete critically damped spring toward the target lane.
// With pole r the gains are k = (1 - r)^2 and c = 1 - r^2, which never overshoot.
// r = 68% settles a 3 m lane change in 16 ticks; r = 64% (full speed) in 14.
// ---------------------------------------------------------------------------

export const LANE_POLE_SLOW = percent(68)
export const LANE_POLE_FAST = percent(64)
export const ACQUIRE_DISTANCE = centimetres(8)
export const ACQUIRE_SPEED = centimetres(2)
/** Lateral speed at or above which rail contact is a hard impact. */
export const HARD_IMPACT_SPEED = centimetres(15)
/** Lateral speed at or above which a landing is hard. */
export const HARD_LANDING_SPEED = centimetres(12)
/** A hit shoves the courier toward the nearest free lane at this lateral speed. */
export const HIT_DEFLECT_SPEED = centimetres(12)
/** A wall returns the courier inward at this lateral speed. */
export const WALL_BOUNCE_SPEED = centimetres(10)
/** Released from a rail grind at this inward lateral speed. */
export const EDGE_RELEASE_SPEED = centimetres(8)
/** Wind offsets the lane target by `amplitude (mm/tick) * GUST_OFFSET_TICKS`. */
export const GUST_OFFSET_TICKS = 16

// ---------------------------------------------------------------------------
// Vertical motion (m/tick)
// ---------------------------------------------------------------------------

export const GRAVITY = 475
/** ~0.7 s of air, ~1.5 m apex. */
export const JUMP_VELOCITY = 9975
/** ~1.1 s of air, ~3.9 m apex. */
export const RAMP_VELOCITY = 15675
/** Speed-gated ramp at or above its threshold: ~1.5 s of air, ~7.5 m apex. */
export const CUT_LAUNCH_VELOCITY = 21375
/** Speed-gated ramp below its threshold: the deck gives way after a short hop. */
export const STALL_LAUNCH_VELOCITY = 4750

// ---------------------------------------------------------------------------
// Timers (ticks)
// ---------------------------------------------------------------------------

export const SLIDE_TICKS = 36
export const STUMBLE_TICKS = 48
export const WALL_STUMBLE_TICKS = 20
export const RESPAWN_STUMBLE_TICKS = 24
export const ACTION_BUFFER_TICKS = 8
export const CLEAN_LANDING_AIR_TICKS = 24
export const FALL_TICKS = 66
export const TETHER_TICKS = 54
export const RUSH_TICKS = 240
/** Rail grind recovery window by tier. */
export const GRIND_WINDOW_TICKS: Readonly<Record<Tier, number>> = { 0: 55, 1: 40, 2: 32 }
/** At most one paid clean lane change per this many ticks on average over the leg. */
export const LANE_CHANGE_REWARD_TICKS = 60

// ---------------------------------------------------------------------------
// Collision envelopes (m)
// ---------------------------------------------------------------------------

/** Barriers, sweepers and low event bodies are cleared at this height. */
export const LOW_HAZARD_HEIGHT = centimetres(90)
/** A blocked lane hits within `laneWidth / 2 - HIT_MARGIN` of its centre. */
export const HIT_MARGIN = centimetres(30)
export const NEAR_MISS_CLEARANCE = centimetres(50)
/** An airborne courier is over a gap when at least this high. */
export const GAP_CLEARANCE = centimetres(25)
/** Maintenance machine half-extent across the road. */
export const MACHINE_HALF = centimetres(210)
/** Transit vehicle half-length across the road. */
export const VEHICLE_HALF = centimetres(300)

// ---------------------------------------------------------------------------
// World event timing (ticks)
// ---------------------------------------------------------------------------

/** A maintenance machine flashes in its start lane this long before drifting. */
export const MACHINE_WARN_TICKS = 40
/** Crossing signals run this long before the transit vehicle enters the road. */
export const TRANSIT_WARN_TICKS = 50
/** A collapsing gantry takes this long to hit the deck once it lets go. */
export const GANTRY_FALL_TICKS = 18
/** Drones in a pattern glide to their next lanes over the last ticks of each step. */
export const DRONE_HOP_TICKS = 10
/** Crosswind blows for 3/5 of its period and lulls for the rest. */
export const CROSSWIND_BLOW_FIFTHS = 3

// ---------------------------------------------------------------------------
// Ghost
// ---------------------------------------------------------------------------

export const GHOSTLINE_STEP = 4 * ONE
export const DRAFT_RANGE = centimetres(45)
export const DRAFT_MAX_LEAD_TICKS = 90
/** The ghost holds a clear lead once it is this many ticks ahead. */
export const GHOST_LEAD_MARGIN = 15

// ---------------------------------------------------------------------------
// FLOW
// ---------------------------------------------------------------------------

export const FLOW = {
  PERFECT_GATE: percent(4),
  PULSE_GATE: percent(8),
  NEAR_MISS: percent(4),
  CLEAN_LANDING: percent(3),
  CLEAN_LANE_CHANGE: percent(1),
  EDGE_SAVE: percent(6),
  OVERTAKE: percent(4),
  /** ~2.4% per second while drafting. */
  DRAFT_TICK: 26,
  RISK_CLEAR: percent(12),
  RELAY_CUT: percent(15),
  RAIL_TICK: 66,
  PAD_TICK: 98,
  HIT: percent(30),
  FALL: percent(45),
  MISSED_GATE: percent(4),
  HARD_LANDING: percent(5),
  RAIL_IMPACT: percent(12),
  /** A soft rail contact costs at least the save it can earn back. */
  EDGE_CONTACT: percent(6),
  WALL_BUMP: percent(3),
  /** ~6% per second on the shoulder. */
  SHOULDER_TICK: 66,
  /** ~12% per second while grinding. */
  GRIND_TICK: 131,
  /** ~1.5% per second. */
  DECAY_TICK: 16,
  /** FLOW left when Relay Rush ends on its own. */
  RUSH_END: percent(70),
} as const
