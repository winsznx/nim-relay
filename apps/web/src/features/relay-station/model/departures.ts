import type { NetworkBaton } from '@nim-relay/shared'
import type { RelayView } from '../../relays/model'
import { worldName } from '../../relays/format'
import type { CrewStatus, RivalryStatus, StationContext } from './context'
import type { DepartureRow, DepartureService } from './types'

/** Rows the physical board has flaps for. */
export const DEPARTURE_ROWS = 6

const SERVICE: Record<NetworkBaton['mode'], DepartureService> = {
  global: 'Global',
  quick: 'Quick',
  crew: 'Crew',
  rival: 'Rival',
}

/** Most urgent first: an unfinished pass, your legs, then the network's standing services. */
export function departureRows(context: StationContext): DepartureRow[] {
  const rows: DepartureRow[] = []
  const listed = new Set<string>()
  const { pendingPass, liveGlobal } = context

  if (pendingPass) {
    rows.push({
      key: `pass-${pendingPass.intent.id}`,
      service: 'Pass',
      destination: pendingPass.relay?.name ?? `Leg ${pendingPass.intent.leg}`,
      status: 'Confirm',
      tone: 'opportunity',
    })
    if (pendingPass.relay) listed.add(pendingPass.relay.id)
  }

  for (const relay of context.yourTurns) {
    rows.push(turnRow(context, relay))
    listed.add(relay.id)
  }

  if (!liveGlobal) {
    rows.push({ key: 'global-idle', service: 'Global', destination: 'No active relay', status: '', tone: 'idle' })
  } else if (!listed.has(liveGlobal.id)) {
    rows.push({ key: `global-${liveGlobal.id}`, service: 'Global', destination: liveGlobal.name, status: `Leg ${liveGlobal.handoffCount + 1}`, tone: 'live' })
  }

  rows.push(dailyRow(context))
  if (context.crew) rows.push(crewRow(context.crew))

  for (const match of context.quickMatches) {
    if (match.yourTurn || listed.has(match.relay.id)) continue
    rows.push({ key: `quick-${match.relay.id}`, service: 'Quick', destination: versus(match.opponent), status: `${match.yourWins}-${match.theirWins}`, tone: 'idle' })
  }

  for (const rivalry of context.rivalries) rows.push(rivalRow(rivalry))

  return rows.slice(0, DEPARTURE_ROWS)
}

function versus(opponent: string | null): string {
  return opponent ? `vs ${opponent}` : 'vs your opponent'
}

function turnRow(context: StationContext, relay: RelayView): DepartureRow {
  const match = context.quickMatches.find(candidate => candidate.relay.id === relay.id)
  return {
    key: `turn-${relay.id}`,
    service: SERVICE[relay.mode],
    destination: match ? versus(match.opponent) : relay.name,
    status: match ? 'Your turn' : 'Your leg',
    tone: 'opportunity',
  }
}

function dailyRow(context: StationContext): DepartureRow {
  const { daily } = context
  const destination = worldName(daily.world)
  if (daily.position !== null) return { key: 'daily', service: 'Daily', destination, status: `Rank ${daily.position}`, tone: 'idle' }
  if (daily.started) return { key: 'daily', service: 'Daily', destination, status: 'Started', tone: 'idle' }
  return { key: 'daily', service: 'Daily', destination, status: 'Open', tone: 'opportunity' }
}

function crewRow(status: CrewStatus): DepartureRow {
  const { crew } = status
  const base = { key: `crew-${crew.id}`, service: 'Crew' as const, destination: crew.name }
  if (status.atRisk) return { ...base, status: 'At risk', tone: 'opportunity' }
  if (crew.todayHandoffs > 0) return { ...base, status: `Streak ${crew.streak}`, tone: 'idle' }
  return { ...base, status: 'No streak', tone: 'idle' }
}

function rivalRow({ rival, side, outcome }: RivalryStatus): DepartureRow {
  const [mine, theirs] = side === 1 ? [rival.scores[1], rival.scores[0]] : rival.scores
  const status = {
    won: 'Won',
    lost: 'Lost',
    decided: 'Decided',
    ended: 'Ended',
    open: `${mine}-${theirs}/${rival.target}`,
  }[outcome]
  return { key: `rival-${rival.id}`, service: 'Rival', destination: rival.title, status, tone: 'idle' }
}
