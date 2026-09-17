import { ONE } from '../fixed-point'
import { DRAFT_MAX_LEAD_TICKS, DRAFT_RANGE, FLOW, GHOST_LEAD_MARGIN, RUSH_TICKS } from './constants'
import { addMoment, gainFlow, type Draft } from './flow'
import { groundAt, pathCode } from './geometry'
import { ghostPathCodeAt, ghostTickAt, ghostXAt } from './ghost-sample'
import { EVENT, MAX_TICKS } from './types'

/**
 * Ghost lead, overtakes and drafting against the previous runner's Ghostline. The lead is
 * positive while the ghost reached the current distance earlier. Where the ghost never got
 * to, the courier is ahead by definition.
 */
export function updateGhost(s: Draft): void {
  const ghostline = s.config.ghostline
  if (!ghostline) return
  const ghostTick = ghostTickAt(ghostline, s.dist)
  const lead = ghostTick < 0 ? s.tick - MAX_TICKS : s.tick - ghostTick
  s.ghostLeadTicks = lead
  if (s.ghostAhead === 1 && lead <= 0) {
    s.ghostAhead = 0
    s.events |= EVENT.GHOST_OVERTAKE
    s.metrics.overtakes++
    gainFlow(s, FLOW.OVERTAKE)
    if (s.metrics.overtakes === 1) addMoment(s, 'ghost-overtake')
  } else if (s.ghostAhead === 0 && lead >= GHOST_LEAD_MARGIN) {
    s.ghostAhead = 1
    s.events |= EVENT.GHOST_OVERTAKEN
  }
  if (ghostTick < 0 || lead <= 0 || lead > DRAFT_MAX_LEAD_TICKS || s.motion !== 'riding') return
  if (ghostPathCodeAt(ghostline, s.dist) !== pathCode(s.path)) return
  if (Math.abs(s.x - ghostXAt(ghostline, s.dist)) > DRAFT_RANGE) return
  s.events |= EVENT.DRAFTING
  s.metrics.draftTicks++
  gainFlow(s, FLOW.DRAFT_TICK)
}

/**
 * Relay Rush: full FLOW starts RUSH_TICKS of extra speed with FLOW pinned at full. A hit or
 * a fall ends it on the spot; running out drops FLOW to FLOW.RUSH_END.
 */
export function updateRush(s: Draft, flowBefore: number): void {
  if (s.rushTicks > 0) {
    s.rushTicks--
    s.metrics.rushTicks++
    s.flow = s.rushTicks === 0 ? FLOW.RUSH_END : ONE
  } else if (s.flow === ONE && (s.motion === 'riding' || s.motion === 'grinding')) {
    s.rushTicks = RUSH_TICKS
    s.metrics.rushes++
    s.events |= EVENT.RUSH_START
    if (s.metrics.rushes === 1) addMoment(s, 'rush')
  }
  if (s.flow === ONE && flowBefore < ONE) s.events |= EVENT.FLOW_MAX
}

export function settleFlow(s: Draft): void {
  s.metrics.flowSum += s.flow
  if (s.flow > s.metrics.flowPeak) s.metrics.flowPeak = s.flow
}

export function finishTick(s: Draft): void {
  if (s.finished) return
  s.ground = groundAt(s.track, s.dist)
  const arrived = s.dist >= s.track.finishDist
  if (arrived) {
    s.events |= EVENT.FINISH
    s.motion = 'finished'
  }
  if (arrived || s.tick >= MAX_TICKS) s.finished = 1
}
