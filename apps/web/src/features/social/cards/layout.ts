import type { RelayNetwork, ShareSurface, StationWorld } from '@nim-relay/shared'
import { countryName, formatCount, formatDuration, formatNim, formatRaceTime, networkLabel, worldName } from '../../relays/format'
import { pathFor } from '../../shell/router'

/** Moments worth sharing, each built only from verified server data. */
export type ShareCard = ResultCard | HandoffCard | DailyCard | CrewCard | MilestoneCard | ChronicleCard | RivalCard

export interface ResultCard {
  kind: 'result'
  runner: { name: string; handle: string }
  world: StationWorld
  timeMs: number
  /** The verified ghost the leg raced, when it raced one. */
  ghost: { name: string; timeMs: number } | null
  perfectGates: { hit: number; total: number } | null
  /** Flow control percent of the verified run. */
  flowControl: number | null
  /** The baton the leg was carried on. The card then opens its journey instead of the runner. */
  relay: { code: string; name: string; leg: number } | null
}

export interface HandoffCard {
  kind: 'handoff'
  /** `country` is the runner's consented, network-observed country, or null. */
  from: { name: string; country: string | null }
  to: { name: string; country: string | null }
  leg: number
  batonName: string
  code: string
  valueLuna: number
  network: RelayNetwork
}

export interface DailyCard {
  kind: 'daily'
  runnerName: string
  date: string
  world: StationWorld
  timeMs: number
  rank: number
  total: number
  topPercent: number | null
}

export interface CrewCard {
  kind: 'crew'
  crewName: string
  streak: number
  bestStreak: number
  members: number
  color: string
}

export interface MilestoneCard {
  kind: 'milestone'
  batonName: string
  code: string
  milestone: BatonMilestone
  handoffs: number
  wallets: number
  countries: number
  network: RelayNetwork
}

export interface ChronicleCard {
  kind: 'chronicle'
  code: string
  identity: string
  name: string
  network: RelayNetwork
  valueLuna: number
  handoffs: number
  transactingWallets: number
  countries: number
  aliveMs: number
  /** "Nigeria → Brazil", or null while no consented country is on the route. */
  route: string | null
  runnerNames: readonly string[]
}

export interface RivalCard {
  kind: 'rival'
  title: string
  target: number
  /** Gold team first. `captain` started the team baton. */
  teams: readonly [{ captain: string; score: number }, { captain: string; score: number }]
  winner: 'gold' | 'cyan' | null
}

export interface CardStat {
  value: string
  label: string
}

export type CardMotif =
  | { kind: 'comet' }
  | { kind: 'pass' }
  | { kind: 'chain'; filled: number }
  | { kind: 'rings' }
  | { kind: 'route'; stops: number }
  | { kind: 'lanes'; target: number; captains: readonly [string, string]; scores: readonly [number, number]; winner: 'gold' | 'cyan' | null }

export interface CardLayout {
  surface: ShareSurface
  /** In-app path the card links to. */
  path: string
  fileName: string
  /** Share sheet title. */
  title: string
  /** Sentence that travels with the image. */
  text: string
  /** Accent color for the kicker and motif. */
  accent: string
  /** Cyan badge for server-verified facts, or null. */
  badge: string | null
  kicker: string
  headline: string
  caption: string | null
  /** A quieter second line, such as the runners who carried the baton. */
  detail: string | null
  stats: CardStat[]
  motif: CardMotif
  /** Quiet line about where the facts come from. */
  footer: string
}

const GOLD = '#F5A623'
const WALLET_MILESTONES = [10, 25, 50, 100, 250, 500, 1000] as const
/** Handoff numbers the server itself celebrates (apps/worker HANDOFF_MILESTONES). */
const HANDOFF_MILESTONES = [10, 25, 50, 100, 250] as const

export interface BatonMilestone {
  count: number
  unit: 'wallets' | 'handoffs'
}

const highest = (steps: readonly number[], value: number) => [...steps].reverse().find(step => value >= step) ?? null

/** The largest milestone a baton has really reached: transacting wallets first, then verified handoffs. */
export function batonMilestone(counts: { wallets: number; handoffs: number }): BatonMilestone | null {
  const wallets = highest(WALLET_MILESTONES, counts.wallets)
  if (wallets !== null) return { count: wallets, unit: 'wallets' }
  const handoffs = highest(HANDOFF_MILESTONES, counts.handoffs)
  return handoffs === null ? null : { count: handoffs, unit: 'handoffs' }
}

const NO_BREAK_SPACE = '\u00a0'

/** Uppercase display name, as the race HUD writes runners. Its words are joined with no-break spaces so a headline never splits a name. */
export function shoutName(name: string): string {
  const trimmed = name.trim()
  return (trimmed.length > 0 ? trimmed : 'Runner').toUpperCase().replace(/\s+/g, NO_BREAK_SPACE)
}

const seconds = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(2)}s`

/** The race HUD's verdict, from the runner's side of the race. */
export function resultHeadline(timeMs: number, ghost: { name: string; timeMs: number } | null): string {
  if (!ghost) return `FINISHED IN ${seconds(timeMs)}`
  const margin = seconds(Math.abs(ghost.timeMs - timeMs))
  if (timeMs < ghost.timeMs) return `YOU BEAT ${shoutName(ghost.name)} BY ${margin}`
  if (timeMs > ghost.timeMs) return `${shoutName(ghost.name)} BEAT YOU BY ${margin}`
  return `DEAD HEAT WITH ${shoutName(ghost.name)}`
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'card'

const plural = (count: number, one: string, many: string) => `${formatCount(count)} ${count === 1 ? one : many}`

function dailyDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase()
}

function resultLayout(card: ResultCard): CardLayout {
  const headline = resultHeadline(card.timeMs, card.ghost)
  const stats: CardStat[] = [{ value: seconds(card.timeMs), label: 'TIME' }]
  if (card.perfectGates) stats.push({ value: `${card.perfectGates.hit}/${card.perfectGates.total}`, label: 'PERFECT GATES' })
  if (card.flowControl !== null) stats.push({ value: `${card.flowControl}%`, label: 'FLOW CONTROL' })
  return {
    surface: 'result',
    path: card.relay ? pathFor('relay', { code: card.relay.code }) : pathFor('runner', { handle: card.runner.handle }),
    fileName: `nim-relay-result-${slug(card.relay?.code ?? card.runner.handle)}.png`,
    title: 'NIM Relay result',
    text: `${headline} on ${worldName(card.world)}.`,
    accent: GOLD,
    badge: 'VERIFIED RIDE',
    kicker: card.relay ? `LEG ${formatCount(card.relay.leg)} · ${worldName(card.world).toUpperCase()}` : worldName(card.world).toUpperCase(),
    headline,
    caption: card.relay ? `${card.runner.name} on ${card.relay.name}` : card.runner.name,
    detail: null,
    stats,
    motif: { kind: 'comet' },
    footer: 'Every ranked ride is replayed and verified by the relay server.',
  }
}

function handoffLayout(card: HandoffCard): CardLayout {
  // The arrow stays with the sender, so a wrapped pass reads "TIM →" over "MARIANA".
  const headline = `${shoutName(card.from.name)}${NO_BREAK_SPACE}→ ${shoutName(card.to.name)}`
  const route = card.from.country && card.to.country ? `${countryName(card.from.country)} → ${countryName(card.to.country)}` : null
  return {
    surface: 'handoff',
    path: pathFor('chronicle', { code: card.code }),
    fileName: `nim-relay-handoff-${slug(card.code)}-${card.leg}.png`,
    title: `${card.batonName}, handoff #${card.leg}`,
    text: `${card.from.name} passed ${card.batonName} to ${card.to.name}. Handoff #${card.leg}, verified on Nimiq.`,
    accent: GOLD,
    badge: 'VERIFIED ON NIMIQ',
    kicker: `HANDOFF #${formatCount(card.leg)} · ${card.batonName.toUpperCase()}`,
    headline,
    caption: route,
    detail: null,
    stats: [
      { value: formatNim(card.valueLuna), label: 'PASSED HAND TO HAND' },
      { value: `#${formatCount(card.leg)}`, label: 'HANDOFF' },
    ],
    motif: { kind: 'pass' },
    footer: `A ${networkLabel(card.network)} transaction, independently verified.`,
  }
}

function dailyLayout(card: DailyCard): CardLayout {
  const top = card.topPercent !== null && card.topPercent < 100 ? card.topPercent : null
  const headline = top !== null ? `TOP ${top}% IN THE DAILY` : `RANKED #${formatCount(card.rank)} IN THE DAILY`
  return {
    surface: 'daily',
    path: pathFor('daily'),
    fileName: `nim-relay-daily-${card.date}.png`,
    title: 'NIM Relay Daily Circuit',
    text: `${top !== null ? `Top ${top}%` : `Ranked #${formatCount(card.rank)}`} in the NIM Relay Daily on ${worldName(card.world)}, ${formatRaceTime(card.timeMs)}.`,
    accent: GOLD,
    badge: 'VERIFIED RIDE',
    kicker: `DAILY CIRCUIT · ${dailyDate(card.date)}`,
    headline,
    caption: `${card.runnerName} on ${worldName(card.world)}`,
    detail: null,
    stats: [
      { value: formatRaceTime(card.timeMs), label: 'TIME' },
      { value: `#${formatCount(card.rank)} of ${formatCount(card.total)}`, label: 'RANK' },
      ...(top !== null ? [{ value: `${top}%`, label: 'TOP' }] : []),
    ],
    motif: { kind: 'rings' },
    footer: 'One course for everyone. Every ranked ride replayed by the server.',
  }
}

function crewLayout(card: CrewCard): CardLayout {
  const days = `${formatCount(card.streak)}-DAY RELAY STREAK`
  return {
    surface: 'crew',
    path: pathFor('crew'),
    fileName: `nim-relay-crew-${slug(card.crewName)}.png`,
    title: `${card.crewName} on NIM Relay`,
    text: `${card.crewName} kept a ${formatCount(card.streak)}-day relay streak with verified passes.`,
    accent: card.color,
    badge: 'VERIFIED PASSES',
    kicker: 'CREW',
    headline: `${card.crewName.toUpperCase()} · ${days}`,
    caption: 'One verified pass between members, every day',
    detail: null,
    stats: [
      { value: formatCount(card.streak), label: card.streak === 1 ? 'DAY' : 'DAYS' },
      { value: formatCount(card.bestStreak), label: 'BEST STREAK' },
      { value: formatCount(card.members), label: card.members === 1 ? 'RUNNER' : 'RUNNERS' },
    ],
    motif: { kind: 'chain', filled: card.streak },
    footer: 'Every streak day is a verified Nimiq handoff.',
  }
}

function milestoneLayout(card: MilestoneCard): CardLayout {
  const unit = card.milestone.unit === 'wallets' ? 'WALLETS' : 'HANDOFFS'
  const headline = `${card.batonName.toUpperCase()} REACHED ${formatCount(card.milestone.count)} ${unit}`
  return {
    surface: 'chronicle',
    path: pathFor('chronicle', { code: card.code }),
    fileName: `nim-relay-milestone-${slug(card.code)}-${card.milestone.count}.png`,
    title: `${card.batonName} milestone`,
    text: `${card.batonName} reached ${formatCount(card.milestone.count)} ${card.milestone.unit === 'wallets' ? 'transacting wallets' : 'verified handoffs'}.`,
    accent: GOLD,
    badge: 'VERIFIED ON NIMIQ',
    kicker: 'MILESTONE',
    headline,
    caption: null,
    detail: null,
    stats: [
      { value: formatCount(card.handoffs), label: 'HANDOFFS' },
      { value: formatCount(card.wallets), label: 'WALLETS' },
      { value: formatCount(card.countries), label: 'COUNTRIES' },
    ],
    motif: { kind: 'rings' },
    footer: `${networkLabel(card.network)}. Wallets are linked accounts, not verified people.`,
  }
}

function chronicleLayout(card: ChronicleCard): CardLayout {
  return {
    surface: 'chronicle',
    path: pathFor('chronicle', { code: card.code }),
    fileName: `nim-relay-${slug(card.code)}.png`,
    title: card.name,
    text: `${card.identity}: ${plural(card.handoffs, 'verified handoff', 'verified handoffs')} in ${formatDuration(card.aliveMs)}.`,
    accent: GOLD,
    badge: card.handoffs > 0 ? 'VERIFIED ON NIMIQ' : null,
    kicker: card.identity.toUpperCase(),
    headline: (card.route ?? card.name).toUpperCase(),
    caption: card.name === card.identity ? `Carrying ${formatNim(card.valueLuna)}` : `${card.name}, carrying ${formatNim(card.valueLuna)}`,
    detail: card.runnerNames.length > 1 ? card.runnerNames.slice(-5).join(' → ') : null,
    stats: [
      { value: formatCount(card.handoffs), label: 'HANDOFFS' },
      { value: formatCount(card.transactingWallets), label: 'WALLETS' },
      { value: formatCount(card.countries), label: 'COUNTRIES' },
      { value: formatDuration(card.aliveMs), label: 'ALIVE' },
    ],
    motif: { kind: 'route', stops: Math.max(1, card.runnerNames.length) },
    footer: card.network === 'MainAlbatross' ? 'Nimiq mainnet. Every handoff independently verified.' : 'Nimiq testnet evidence, kept separate from mainnet usage.',
  }
}

function rivalLayout(card: RivalCard): CardLayout {
  const [gold, cyan] = card.teams
  const score = `${formatCount(gold.score)}–${formatCount(cyan.score)}`
  const leading = card.winner ?? (gold.score === cyan.score ? null : gold.score > cyan.score ? 'gold' : 'cyan')
  const captain = leading === 'gold' ? gold.captain : leading === 'cyan' ? cyan.captain : null
  const caption = captain === null ? `Level at ${score}` : card.winner ? `${captain}’s team won ${score}` : `${captain}’s team leads ${score}`
  return {
    // Rivalries live under the Crew tab, and the share metric has no rivalry surface of its own.
    surface: 'crew',
    path: pathFor('rivals'),
    fileName: `nim-relay-rivalry-${slug(card.title)}.png`,
    title: card.title,
    text: `${card.title}: ${caption}. First to ${formatCount(card.target)} verified handoffs.`,
    accent: GOLD,
    badge: 'VERIFIED HANDOFFS',
    kicker: `RIVALRY · FIRST TO ${formatCount(card.target)}`,
    headline: card.title.toUpperCase(),
    caption,
    detail: null,
    stats: [],
    motif: { kind: 'lanes', target: card.target, captains: [gold.captain, cyan.captain], scores: [gold.score, cyan.score], winner: card.winner },
    footer: 'Two batons, one NIM each. Nothing is wagered.',
  }
}

export function cardLayout(card: ShareCard): CardLayout {
  switch (card.kind) {
    case 'result':
      return resultLayout(card)
    case 'handoff':
      return handoffLayout(card)
    case 'daily':
      return dailyLayout(card)
    case 'crew':
      return crewLayout(card)
    case 'milestone':
      return milestoneLayout(card)
    case 'chronicle':
      return chronicleLayout(card)
    case 'rival':
      return rivalLayout(card)
  }
}
