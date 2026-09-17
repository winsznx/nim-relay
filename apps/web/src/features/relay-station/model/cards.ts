import type { NetworkHandoffIntent } from '@nim-relay/shared'
import type { RelayView } from '../../relays/model'
import { formatCount, formatDuration, networkLabel, worldName } from '../../relays/format'
import type { StationContext } from './context'
import { countNoun } from './displays'
import type { ChronicleView, CourierView, LiveView, RankingsView, StationAction, StationCard, StationFact, StationSurfaceId, VaultView, WorldView } from './types'

const MAX_FACTS = 3

export interface CardInputs {
  world: WorldView
  vault: VaultView
  courier: CourierView
  chronicle: ChronicleView
  live: LiveView
  rankings: RankingsView
}

export function stationCards(context: StationContext, inputs: CardInputs): Record<StationSurfaceId, StationCard> {
  return {
    departures: departuresCard(context),
    world: worldCard(context, inputs.world),
    live: liveCard(context, inputs.live),
    rankings: rankingsCard(context, inputs.rankings),
    chronicle: chronicleCard(context, inputs.chronicle),
    vault: vaultCard(context, inputs.vault),
    courier: courierCard(inputs.courier),
  }
}

function card(title: string, facts: StationFact[], action: StationAction): StationCard {
  return { title, facts: facts.slice(0, MAX_FACTS), action }
}

function departuresCard(context: StationContext): StationCard {
  const { pendingPass, yourTurns, liveGlobal, crew, daily } = context
  const facts: StationFact[] = []

  if (pendingPass) {
    facts.push({ text: `Your pass to ${pendingPass.intent.recipientName} is waiting for ${passWaitingOn(pendingPass.intent.state)}.`, tone: 'opportunity' })
  }
  for (const relay of yourTurns) {
    const match = context.quickMatches.find(candidate => candidate.relay.id === relay.id)
    facts.push({ text: match ? `It's your turn against ${match.opponent ?? 'your opponent'}.` : `Your leg of ${relay.name} is ready.`, tone: 'opportunity' })
  }
  if (liveGlobal && !yourTurns.includes(liveGlobal)) facts.push({ text: `${liveGlobal.holder.name} is carrying ${liveGlobal.name} on leg ${liveGlobal.handoffCount + 1}.`, tone: 'live' })
  if (crew?.atRisk) facts.push({ text: `${crew.crew.name} loses its ${crew.crew.streak}-day streak in ${formatDuration(crew.msLeft)} without a handoff.`, tone: 'opportunity' })
  if (daily.position !== null) facts.push({ text: `You placed #${daily.position} in today's Daily.`, tone: 'idle' })
  else if (daily.started) facts.push({ text: 'Your official Daily ride has started.', tone: 'idle' })
  else facts.push({ text: `Today's Daily runs on ${worldName(daily.world)}.`, tone: 'opportunity' })
  if (!liveGlobal) facts.push({ text: 'No Global Relay is active right now.', tone: 'idle' })

  return card('Departures', facts, departuresAction(context))
}

function passWaitingOn(state: NetworkHandoffIntent['state']): string {
  switch (state) {
    case 'prepared':
      return 'your approval'
    case 'attempting':
      return 'your wallet'
    default:
      return 'network confirmation'
  }
}

function departuresAction(context: StationContext): StationAction {
  const { pendingPass, yourTurns, crew, daily, liveGlobal } = context
  if (pendingPass?.relay) return { label: 'Finish your pass', route: `/relay/${pendingPass.relay.code}` }
  const turn = yourTurns[0]
  if (turn) return { label: 'Run your leg', route: `/leg/${turn.code}` }
  if (context.unread > 0) return { label: 'Open your inbox', route: '/inbox' }
  if (crew?.atRisk) return { label: 'Keep the streak', route: '/crew' }
  if (daily.position === null && !daily.started) return { label: 'Ride the Daily', route: '/daily' }
  if (liveGlobal) return { label: 'Follow the Global Relay', route: `/relay/${liveGlobal.code}` }
  return { label: 'Start a relay', route: '/start' }
}

function worldCard(context: StationContext, world: WorldView): StationCard {
  const facts: StationFact[] = []
  if (world.activeRelays === 0) facts.push({ text: 'No active relays yet.', tone: 'idle' })
  else facts.push({ text: `${countNoun(world.activeRelays, 'relay')} in play across ${countNoun(world.stations, 'Atlas station')}.`, tone: 'live' })
  facts.push({ text: `${countNoun(world.confirmedHandoffs, 'confirmed handoff')} on ${networkLabel(context.snapshot.network)}.`, tone: 'idle' })

  const latest = [...context.relays].filter(relay => relay.status === 'active').sort((a, b) => b.updatedAt - a.updatedAt)[0]
  const action = context.liveGlobal
    ? { label: 'Follow the Global Relay', route: `/relay/${context.liveGlobal.code}` }
    : latest
      ? { label: 'Follow the latest relay', route: `/relay/${latest.code}` }
      : { label: 'Start a relay', route: '/start' }
  return card('World routes', facts, action)
}

function liveCard(context: StationContext, live: LiveView): StationCard {
  const relay = context.liveGlobal
  if (live.state === 'idle' || !relay) {
    return card('Live relay', [{ text: 'No Global Relay is live right now.', tone: 'idle' }, { text: 'A new one starts with a single runner.', tone: 'opportunity' }], {
      label: 'Start a Global Relay',
      route: '/start',
    })
  }
  const facts: StationFact[] = [{ text: live.yours ? `You are carrying ${live.journey}.` : `${live.runner} is carrying ${live.journey}.`, tone: 'live' }]
  facts.push({ text: live.lastPass ? `Leg ${live.leg} after ${countNoun(live.handoffs, 'confirmed handoff')}, the last one ${live.lastPass} ago.` : `Leg ${live.leg}. No handoff yet.`, tone: 'idle' })
  facts.push(live.ghostReady ? { text: "The previous runner's verified ghost is waiting.", tone: 'live' } : { text: 'This leg has no ghost to race yet.', tone: 'idle' })
  const action = live.yours ? { label: 'Run your leg', route: `/leg/${relay.code}` } : { label: 'Watch the relay', route: `/relay/${relay.code}` }
  return card('Live relay', facts, action)
}

function rankingsCard(context: StationContext, rankings: RankingsView): StationCard {
  const { daily } = context
  const facts: StationFact[] = []
  if (daily.leader) facts.push({ text: `${daily.leader.name} leads today's Daily with ${formatCount(daily.leader.score)}.`, tone: 'idle' })
  else facts.push({ text: 'No official Daily rides yet today.', tone: 'idle' })
  if (daily.position !== null) {
    const field = daily.riders >= 100 ? 'on the top 100' : `of ${formatCount(daily.riders)}`
    facts.push({ text: `You're #${daily.position} ${field} today.`, tone: 'opportunity' })
  }
  if (rankings.season.rank !== null && rankings.season.xp !== null) facts.push({ text: `Your season rank is ${rankings.season.rank} with ${formatCount(rankings.season.xp)} XP.`, tone: 'idle' })
  const ghost = rankings.ghosts[0]
  if (ghost) facts.push({ text: `${ghost.name} has beaten the most ghosts, ${ghost.value}.`, tone: 'idle' })
  return card('Rankings', facts, { label: 'Open the Daily', route: '/daily' })
}

function chronicleCard(context: StationContext, chronicle: ChronicleView): StationCard {
  const facts: StationFact[] = []
  const latest = chronicle.achievements[0]
  if (latest) facts.push({ text: `${countNoun(chronicle.achievements.length, 'achievement')} engraved, latest ${latest}.`, tone: 'opportunity' })
  for (const moment of chronicle.moments) facts.push({ text: `${moment.heading}: ${moment.detail}.`, tone: 'idle' })
  if (facts.length === 0) facts.push({ text: 'No moments recorded yet. The first confirmed handoff starts the chronicle.', tone: 'idle' })

  const longest = context.relays.reduce<RelayView | null>((best, relay) => (relay.handoffCount > (best?.handoffCount ?? 0) ? relay : best), null)
  const action = longest
    ? { label: 'Relive the longest journey', route: `/relay/${longest.code}` }
    : context.playerId !== null
      ? { label: 'Open your profile', route: '/profile' }
      : { label: 'Start a relay', route: '/start' }
  return card('Chronicle', facts, action)
}

function vaultCard(context: StationContext, vault: VaultView): StationCard {
  const facts: StationFact[] = []
  if (vault.legend) facts.push({ text: `${vault.legend.name} leads the vault with ${countNoun(vault.legend.handoffs, 'confirmed handoff')}.`, tone: 'idle' })
  else facts.push({ text: 'No Global Relay has a confirmed handoff yet.', tone: 'idle' })
  if (context.playerId === null) facts.push({ text: 'Set up a courier to keep your batons here.', tone: 'idle' })
  else if (vault.yoursTotal > 0) facts.push({ text: `You started or hold ${countNoun(vault.yoursTotal, 'baton')}.`, tone: 'idle' })
  else facts.push({ text: 'Start a relay to place your first baton here.', tone: 'opportunity' })

  const action =
    context.playerId !== null && vault.yoursTotal > 0
      ? { label: 'Open your vault', route: '/profile' }
      : vault.legend
        ? { label: 'View the legend', route: `/relay/${vault.legend.code}` }
        : { label: 'Start a relay', route: '/start' }
  return card('Baton vault', facts, action)
}

function courierCard(courier: CourierView): StationCard {
  if (!courier.setUp) {
    return card('Your courier', [{ text: 'Set up a courier to receive and pass batons.', tone: 'opportunity' }], { label: 'Set up your courier', route: '/profile' })
  }
  const facts: StationFact[] = []
  if (courier.name !== null && courier.level !== null && courier.rank !== null) facts.push({ text: `${courier.name} is a level ${courier.level} ${courier.rank}.`, tone: 'idle' })
  if (courier.xp !== null) facts.push({ text: `${formatCount(courier.xp)} XP earned.`, tone: 'idle' })
  if (courier.handoffs !== null && courier.rides !== null) facts.push({ text: `${countNoun(courier.handoffs, 'baton')} passed over ${countNoun(courier.rides, 'ride')}.`, tone: 'idle' })
  if (facts.length === 0) facts.push({ text: 'Change your suit, helmet, board and trail.', tone: 'idle' })
  return card('Your courier', facts, { label: 'Open courier locker', route: '/profile' })
}
