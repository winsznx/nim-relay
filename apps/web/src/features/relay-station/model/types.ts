import type { NetworkBaton, RelayNetwork, StationProfile } from '@nim-relay/shared'
import type { BatonAppearance } from '../../baton/baton-appearance'

/** Surfaces in walking order around the deck, used for next and previous. */
export const STATION_SURFACES = ['departures', 'rankings', 'world', 'live', 'vault', 'courier', 'chronicle'] as const
export type StationSurfaceId = (typeof STATION_SURFACES)[number]

/** Gold marks something the player can act on, cyan marks live or verified state. */
export type SignalTone = 'opportunity' | 'live' | 'idle'

export interface StationAction {
  label: string
  route: string
}

export interface StationFact {
  text: string
  tone: SignalTone
}

export interface StationCard {
  title: string
  facts: StationFact[]
  action: StationAction
}

export type DepartureService = 'Pass' | 'Global' | 'Quick' | 'Crew' | 'Rival' | 'Daily'

export interface DepartureRow {
  key: string
  service: DepartureService
  destination: string
  /** Empty when there is nothing to report. */
  status: string
  tone: SignalTone
}

export interface WorldRoute {
  id: string
  /** Atlas legs as [origin, destination] station ids, oldest first. Stations are game-world destinations. */
  hops: (readonly [string, string])[]
  live: boolean
}

export interface WorldView {
  activeRelays: number
  /** Distinct Atlas stations the relays in play have touched. */
  stations: number
  confirmedHandoffs: number
  routes: WorldRoute[]
}

export interface VaultBaton {
  id: string
  code: string
  name: string
  handoffs: number
  stations: number
  status: NetworkBaton['status']
  appearance: BatonAppearance
}

export interface VaultView {
  /** The Global Relay baton with the most confirmed handoffs. */
  legend: VaultBaton | null
  yours: VaultBaton[]
  /** Batons the player started or holds, including those not on display. */
  yoursTotal: number
}

export interface CourierView {
  setUp: boolean
  name: string | null
  level: number | null
  rank: string | null
  xp: number | null
  handoffs: number | null
  rides: number | null
  equipped: StationProfile['equipped'] | null
  /** The baton the player holds on an active leg, shown in the courier's hand. */
  carrying: BatonAppearance | null
}

export interface ChronicleEntry {
  heading: string
  detail: string
}

export interface ChronicleView {
  achievements: string[]
  moments: ChronicleEntry[]
}

export interface LiveView {
  state: 'live' | 'idle'
  runner: string | null
  journey: string | null
  /** Leg being raced now, one past the confirmed handoffs. */
  leg: number | null
  handoffs: number
  /** Time since the last confirmed pass, such as "3h 12m". */
  lastPass: string | null
  ghostReady: boolean
  yours: boolean
}

export interface RankLine {
  place: number
  name: string
  value: string
  you: boolean
}

export interface RankingsView {
  season: { rank: string | null; xp: number | null; lines: RankLine[] }
  daily: { world: string; lines: RankLine[]; position: number | null; riders: number }
  ghosts: RankLine[]
}

export interface StationViewData {
  network: RelayNetwork
  signedIn: boolean
  departures: DepartureRow[]
  world: WorldView
  vault: VaultView
  courier: CourierView
  chronicle: ChronicleView
  live: LiveView
  rankings: RankingsView
  cards: Record<StationSurfaceId, StationCard>
}
