import type { BatonDetail, NetworkBaton, NetworkRival, NetworkRunner, NetworkSnapshot, RelayEcho } from '@nim-relay/shared'
import { batonAppearance, type BatonAppearance } from '../baton/baton-appearance'
import { countryName, modeLabel, serialLabel } from './format'

/** View models the screens and the globe share, derived only from the server's verified record. */

export interface Moment {
  id: string
  at: number
  text: string
  batonCode: string | null
}

export function echoText(echo: Pick<RelayEcho, 'kind' | 'leg' | 'runner'>): string {
  switch (echo.kind) {
    case 'ghost-record':
      return `${echo.runner.name} set the sector record on leg ${echo.leg}`
    case 'risk-pioneer':
      return `${echo.runner.name} was first through the risk route on leg ${echo.leg}`
    case 'near-miss-legend':
      return `${echo.runner.name} survived six near misses on leg ${echo.leg}`
    case 'rescue':
      return `${echo.runner.name} rescued a stranded baton on leg ${echo.leg}`
    case 'milestone':
      return `Handoff ${echo.leg} confirmed with ${echo.runner.name}`
    case 'edge-save':
      return `${echo.runner.name} saved a fall at the edge on leg ${echo.leg}`
    case 'relay-cut':
      return `${echo.runner.name} was first to clear the relay cut on leg ${echo.leg}`
  }
}

export interface RouteStop {
  countryCode: string | null
}

export type RelayTeam = 'gold' | 'cyan' | null

export interface RelayView {
  id: string
  code: string
  mode: NetworkBaton['mode']
  status: NetworkBaton['status']
  network: NetworkBaton['network']
  valueLuna: number
  /** The runner-chosen title, or the relay's identity when none was given. */
  name: string
  /** Identity line such as "Global Relay #001". */
  identity: string
  serial: number
  origin: NetworkRunner
  holder: NetworkRunner
  /** Runner the next pass is reserved for, and whether they accepted it. `wallet` is null for a runner missing from the snapshot. */
  next: { id: string; name: string; wallet: string | null; accepted: boolean } | null
  handoffCount: number
  countries: string[]
  runners: number
  ghostWins: number
  createdAt: number
  updatedAt: number
  expiresAt: number
  aliveMs: number
  transactingWallets: number
  stops: RouteStop[]
  previousRunId: string | null
  crewId: string | null
  rivalId: string | null
  team: RelayTeam
  quick: NetworkBaton['quick']
  appearance: BatonAppearance
}

function teamOf(baton: NetworkBaton, rivals: readonly NetworkRival[]): RelayTeam {
  if (baton.mode !== 'rival') return null
  const rivalry = rivals.find(rival => rival.batonIds.includes(baton.id))
  return rivalry?.batonIds[1] === baton.id ? 'cyan' : 'gold'
}

export interface RelayContext {
  runners: readonly NetworkRunner[]
  rivals: readonly NetworkRival[]
  /** When present for this baton, its handoffs refine the route and the baton's look. */
  detail?: BatonDetail | undefined
  now: number
}

export function toRelayView(baton: NetworkBaton, context: RelayContext): RelayView {
  const detail = context.detail?.baton.id === baton.id ? context.detail : undefined
  // Snapshots carry the stop list; single-baton responses rebuild it from the verified handoffs.
  const stops = baton.stops ?? [{ countryCode: baton.origin.country }, ...(detail?.handoffs ?? []).map(handoff => ({ countryCode: handoff.to.country }))]
  // aliveMs is measured when the server answers; an active baton keeps ageing on screen.
  const aliveMs = baton.status === 'active' ? Math.max(baton.aliveMs, context.now - baton.createdAt) : baton.aliveMs
  const reserved = baton.recipientId && baton.recipientId !== baton.holder.id ? baton.recipientId : null
  const nextRunner = reserved ? context.runners.find(runner => runner.id === reserved) : undefined
  const rescues = (detail?.handoffs ?? []).filter(handoff => handoff.rescue).map(() => 'rescue')
  return {
    id: baton.id,
    code: baton.code,
    mode: baton.mode,
    status: baton.status,
    network: baton.network,
    valueLuna: baton.value,
    name: baton.displayName,
    identity: `${modeLabel(baton.mode)} ${serialLabel(baton.serial)}`,
    serial: baton.serial,
    origin: baton.origin,
    holder: baton.holder,
    next: reserved ? { id: reserved, name: nextRunner?.name ?? 'Reserved runner', wallet: nextRunner?.wallet ?? null, accepted: baton.recipientAcceptedAt !== null } : null,
    handoffCount: baton.handoffCount,
    countries: baton.lineage.countries,
    runners: baton.lineage.runners,
    ghostWins: baton.lineage.ghostWins,
    createdAt: baton.createdAt,
    updatedAt: baton.updatedAt,
    expiresAt: baton.expiresAt,
    aliveMs,
    transactingWallets: baton.transactingWallets,
    stops,
    previousRunId: baton.previousRunId,
    crewId: baton.crewId,
    rivalId: baton.rivalId,
    team: teamOf(baton, context.rivals),
    quick: baton.quick,
    appearance: batonAppearance({ handoffCount: baton.handoffCount, ageMs: aliveMs, countries: baton.lineage.countries.length, ghostWins: baton.lineage.ghostWins, milestones: rescues }),
  }
}

export function relayViews(snapshot: NetworkSnapshot, now: number): RelayView[] {
  return snapshot.batons.map(baton => toRelayView(baton, { runners: snapshot.runners, rivals: snapshot.rivals, now }))
}

/** The hero of the world: the active Global Relay, else the most recently moved active baton, else the latest baton. */
export function featuredRelay(relays: readonly RelayView[]): RelayView | null {
  const byRecent = [...relays].sort((a, b) => b.updatedAt - a.updatedAt)
  return byRecent.find(relay => relay.status === 'active' && relay.mode === 'global') ?? byRecent.find(relay => relay.status === 'active') ?? byRecent[0] ?? null
}

/** "Nigeria → Germany", built only from consented countries on the route. */
export function routeLine(stops: readonly RouteStop[]): string {
  const first = stops[0]?.countryCode ?? null
  const last = stops.at(-1)?.countryCode ?? null
  if (stops.length <= 1 || first === last) return countryName(first)
  return `${countryName(first)} → ${countryName(last)}`
}

/**
 * The journey's headline: where it travelled when runners share their country,
 * otherwise who it travelled between. Unknown places are never the headline.
 */
export function journeyHeadline(relay: Pick<RelayView, 'stops' | 'origin' | 'holder'>): string {
  const first = relay.stops[0]?.countryCode ?? null
  const last = relay.stops.at(-1)?.countryCode ?? null
  if (first && last) return routeLine(relay.stops)
  if (relay.origin.id === relay.holder.id) return relay.origin.name
  return `${relay.origin.name} → ${relay.holder.name}`
}

/** Recent real events for the world ticker: echoes, verified handoffs and relay starts. */
export function tickerMoments(relays: readonly RelayView[], featured: RelayView | null, detail: BatonDetail | undefined): Moment[] {
  const moments: Moment[] = []
  if (featured && detail?.baton.id === featured.id) {
    for (const echo of detail.echoes) moments.push({ id: echo.id, at: echo.at, text: echoText(echo), batonCode: featured.code })
    for (const handoff of detail.handoffs.slice(-8)) {
      moments.push({ id: handoff.id, at: handoff.at, text: `${handoff.from.name} passed ${featured.name} to ${handoff.to.name}`, batonCode: featured.code })
    }
  }
  for (const relay of relays) {
    if (relay.handoffCount === 0) moments.push({ id: `${relay.id}-start`, at: relay.createdAt, text: `${relay.origin.name} started ${relay.name}`, batonCode: relay.code })
  }
  return moments.sort((a, b) => b.at - a.at).slice(0, 10)
}
