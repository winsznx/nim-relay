import type { RelayView } from '../../relays/model'
import { formatCount, formatDuration, worldName } from '../../relays/format'
import type { StationContext } from './context'
import type { ChronicleEntry, ChronicleView, CourierView, LiveView, RankLine, RankingsView, VaultBaton, VaultView, WorldRoute, WorldView } from './types'

/** Routes the globe draws; more would not read at its size. */
const WORLD_ROUTES = 24
/** Pedestals beside the legend's. */
const VAULT_PEDESTALS = 2
const RANK_LINES = 5
const GHOST_LINES = 3
const CHRONICLE_MOMENTS = 4
const ACHIEVEMENTS = 6

export function worldView(context: StationContext): WorldView {
  const { relays } = context
  const countries = new Set<string>()
  let hiddenStops = false
  for (const relay of relays) {
    for (const stop of relay.stops) {
      if (stop.countryCode) countries.add(stop.countryCode)
      else hiddenStops = true
    }
  }
  const routes: WorldRoute[] = [...relays]
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || b.handoffCount - a.handoffCount)
    .map(relay => ({ id: relay.id, stops: knownStops(relay), live: relay.status === 'active' }))
    .filter(route => route.stops.length > 0)
    .slice(0, WORLD_ROUTES)
  return {
    activeRelays: relays.filter(relay => relay.status === 'active').length,
    countries: countries.size,
    confirmedHandoffs: context.snapshot.metrics.qualifiedHandoffs,
    routes,
    hiddenStops,
  }
}

function knownStops(relay: RelayView): string[] {
  const stops: string[] = []
  for (const stop of relay.stops) {
    if (stop.countryCode && stops.at(-1) !== stop.countryCode) stops.push(stop.countryCode)
  }
  return stops
}

export function vaultView(context: StationContext): VaultView {
  const { legend, playerId } = context
  const yours =
    playerId === null
      ? []
      : context.relays
          .filter(relay => relay.id !== legend?.id && (relay.origin.id === playerId || relay.holder.id === playerId))
          .sort((a, b) => b.handoffCount - a.handoffCount || b.updatedAt - a.updatedAt)
  const ownsLegend = legend !== null && playerId !== null && (legend.origin.id === playerId || legend.holder.id === playerId)
  return {
    legend: legend ? vaultBaton(legend) : null,
    yours: yours.slice(0, VAULT_PEDESTALS).map(vaultBaton),
    yoursTotal: yours.length + Number(ownsLegend),
  }
}

function vaultBaton(relay: RelayView): VaultBaton {
  return {
    id: relay.id,
    code: relay.code,
    name: relay.name,
    handoffs: relay.handoffCount,
    countries: relay.countries.length,
    status: relay.status,
    appearance: relay.appearance,
  }
}

export function courierView(context: StationContext): CourierView {
  const { profile } = context
  const carrying = context.yourTurns[0]?.appearance ?? context.pendingPass?.relay?.appearance ?? null
  if (!profile) {
    return { setUp: context.playerId !== null, name: null, level: null, rank: null, xp: null, handoffs: null, rides: null, equipped: null, carrying }
  }
  return {
    setUp: true,
    name: profile.name,
    level: profile.level,
    rank: profile.seasonRank,
    xp: profile.xp,
    handoffs: profile.handoffs,
    rides: profile.runs,
    equipped: profile.equipped,
    carrying,
  }
}

export function chronicleView(context: StationContext): ChronicleView {
  return {
    achievements: [...(context.profile?.achievements ?? [])].reverse().slice(0, ACHIEVEMENTS),
    moments: chronicleMoments(context).slice(0, CHRONICLE_MOMENTS),
  }
}

/** Notable moments read straight from the record, most significant first. */
function chronicleMoments(context: StationContext): ChronicleEntry[] {
  const moments: ChronicleEntry[] = []
  const longest = topRelay(context.relays, relay => relay.handoffCount)
  if (longest) moments.push({ heading: 'Longest journey', detail: `${longest.name}, ${countNoun(longest.handoffCount, 'handoff')}` })

  const widest = topRelay(context.relays, relay => (relay.countries.length >= 2 ? relay.countries.length : 0))
  if (widest && widest.id !== longest?.id) moments.push({ heading: 'Widest reach', detail: `${widest.name}, ${countNoun(widest.countries.length, 'country', 'countries')}` })

  const match = [...context.relays]
    .filter(relay => relay.mode === 'quick' && relay.status === 'completed' && relay.quick?.winnerId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  const winnerId = match?.quick?.winnerId
  if (match?.quick && winnerId) {
    const winner = context.snapshot.runners.find(runner => runner.id === winnerId) ?? [match.origin, match.holder].find(runner => runner.id === winnerId)
    const scores = Object.values(match.quick.scores).sort((a, b) => b - a)
    if (winner) moments.push({ heading: 'Match won', detail: `${winner.name} took ${match.name} ${scores.join('-')}` })
  }

  const decided = context.snapshot.rivals.find(rival => rival.winnerId !== null)
  const champion = decided ? context.relays.find(relay => relay.id === decided.winnerId) : undefined
  if (decided && champion) moments.push({ heading: 'Rivalry won', detail: `${champion.name} reached ${countNoun(decided.target, 'handoff')}` })

  const handoff = context.station?.chronicles.find(entry => entry.kind === 'handoff')
  if (handoff) moments.push({ heading: `Global leg ${handoff.leg}`, detail: `${handoff.name} passed the baton` })
  const ride = context.station?.chronicles.find(entry => entry.kind === 'run')
  if (ride) moments.push({ heading: 'Recorded ride', detail: `${ride.name} rode ${worldName(ride.world)} for ${formatCount(ride.score)}` })

  return moments
}

function topRelay(relays: readonly RelayView[], measure: (relay: RelayView) => number): RelayView | null {
  let best: RelayView | null = null
  for (const relay of relays) {
    if (measure(relay) > 0 && (!best || measure(relay) > measure(best))) best = relay
  }
  return best
}

export function liveView(context: StationContext): LiveView {
  const relay = context.liveGlobal
  if (!relay) return { state: 'idle', runner: null, journey: null, leg: null, handoffs: 0, lastPass: null, ghostReady: false, yours: false }
  return {
    state: 'live',
    runner: relay.holder.name,
    journey: relay.name,
    leg: relay.handoffCount + 1,
    handoffs: relay.handoffCount,
    lastPass: relay.handoffCount > 0 ? formatDuration(context.now - relay.updatedAt) : null,
    ghostReady: relay.previousRunId !== null,
    yours: relay.holder.id === context.playerId,
  }
}

export function rankingsView(context: StationContext): RankingsView {
  const { playerId, profile, snapshot } = context
  const seasonLines = (context.station?.rankings ?? []).slice(0, RANK_LINES).map((entry, index) => rankLine(index, entry.name, formatCount(entry.score), entry.id === playerId))
  const dailyLines = snapshot.daily.leaderboard.slice(0, RANK_LINES).map((entry, index) => rankLine(index, entry.player.name, formatCount(entry.score), entry.player.id === playerId))
  const ghosts = context.relays
    .filter(relay => relay.ghostWins > 0)
    .sort((a, b) => b.ghostWins - a.ghostWins)
    .slice(0, GHOST_LINES)
    .map((relay, index) => rankLine(index, relay.name, countNoun(relay.ghostWins, 'win'), false))
  return {
    season: { rank: profile?.seasonRank ?? null, xp: profile?.xp ?? null, lines: seasonLines },
    daily: { world: worldName(context.daily.world), lines: dailyLines, position: context.daily.position, riders: context.daily.riders },
    ghosts,
  }
}

function rankLine(index: number, name: string, value: string, you: boolean): RankLine {
  return { place: index + 1, name, value, you }
}

export function countNoun(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`
}
