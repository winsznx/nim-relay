import type { NetworkBaton, RelayNetwork, StationWorld } from '@nim-relay/shared'

const LUNA_PER_NIM = 100_000

export function formatNim(luna: number): string {
  const nim = luna / LUNA_PER_NIM
  return `${Number.isInteger(nim) ? nim.toLocaleString('en') : nim.toLocaleString('en', { maximumFractionDigits: 5 })} NIM`
}

export function formatLuna(luna: number): string {
  return `${luna.toLocaleString('en')} Luna`
}

export function formatCount(value: number): string {
  return value.toLocaleString('en')
}

const NBSP = ' '

/** Compact age such as "8h 42m" or "3d 4h". The parts never wrap apart. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 1) return `${Math.max(0, Math.floor(ms / 1000))}s`
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${NBSP}${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d${NBSP}${hours % 24}h`
}

export function formatAgo(time: number, now: number): string {
  const seconds = Math.floor((now - time) / 1000)
  if (seconds < 45) return 'Just now'
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 86_400 * 30) return `${Math.floor(seconds / 86_400)}d ago`
  return new Date(time).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Relative time for use mid-sentence, e.g. "started 4m ago". */
export function formatSince(time: number, now: number): string {
  const ago = formatAgo(time, now)
  return ago === 'Just now' ? 'just now' : ago.endsWith('ago') ? ago : `on ${ago}`
}

export function formatRaceTime(ms: number): string {
  const seconds = ms / 1000
  return seconds < 60 ? `${seconds.toFixed(2)}s` : `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`
}

const pad2 = (value: number) => String(value).padStart(2, '0')

/** Leaderboard time as mm:ss.cc, truncated to the hundredth so a ranking never rounds up. */
export function formatBoardTime(ms: number): string {
  const centiseconds = Math.floor(Math.max(0, ms) / 10)
  const minutes = Math.floor(centiseconds / 6000)
  const seconds = Math.floor(centiseconds / 100) % 60
  return `${pad2(minutes)}:${pad2(seconds)}.${pad2(centiseconds % 100)}`
}

/** Time left as HH:MM:SS, with whole days in front once it is a day or more. Partial seconds count as a full second. */
export function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000)
  const days = Math.floor(total / 86_400)
  const clock = `${pad2(Math.floor(total / 3600) % 24)}:${pad2(Math.floor(total / 60) % 60)}:${pad2(total % 60)}`
  return days > 0 ? `${days}d ${clock}` : clock
}

export function formatDateTime(time: number): string {
  return new Date(time).toLocaleString('en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

let regionNames: Intl.DisplayNames | null = null

export const LOCATION_NOT_SHARED = 'Location not shared'

export function countryName(code: string | null): string {
  if (!code) return LOCATION_NOT_SHARED
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' })
    return regionNames.of(code) ?? code
  } catch {
    return code
  }
}

/** Regional-indicator flag for a consented, network-observed country. */
export function flagFor(code: string | null): string | null {
  if (!code || !/^[A-Z]{2}$/.test(code)) return null
  return String.fromCodePoint(...Array.from(code, letter => 0x1f1e6 + letter.charCodeAt(0) - 65))
}

export function shortHash(hash: string): string {
  return hash.length > 20 ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : hash
}

export function serialLabel(serial: number): string {
  return `#${String(serial).padStart(3, '0')}`
}

const MODE_LABELS: Record<NetworkBaton['mode'], string> = {
  global: 'Global Relay',
  quick: 'Quick Relay',
  crew: 'Crew Relay',
  rival: 'Rival Relay',
}

export function modeLabel(mode: NetworkBaton['mode']): string {
  return MODE_LABELS[mode]
}

const WORLD_NAMES: Record<StationWorld, string> = {
  coast: 'Sunbreak Coast',
  alpine: 'Cloudline Alps',
  metro: 'Midnight Metro',
  solar: 'Solar Frontier',
  ocean: 'Ocean Skyway',
}

export function worldName(world: StationWorld): string {
  return WORLD_NAMES[world]
}

export function networkLabel(network: RelayNetwork): string {
  return network === 'MainAlbatross' ? 'Nimiq mainnet' : 'Nimiq testnet'
}

/** Public explorer page for a transaction. nimiq.watch routes 64-hex hashes to its transaction view. */
export function explorerUrl(network: RelayNetwork, txHash: string): string {
  return `${network === 'MainAlbatross' ? 'https://nimiq.watch' : 'https://test.nimiq.watch'}/#${txHash}`
}

export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .map(part => Array.from(part)[0] ?? '')
    .join('')
  return (letters || '?').slice(0, 2).toUpperCase()
}
