import type { BatonDetail, RunnerProfile } from '@nim-relay/shared'

/** What a link preview shows: title, description and a 1200x630 image. */
export interface PageMeta {
  title: string
  description: string
  /** Absolute URL of the page. */
  url: string
  /** Absolute URL of a 1200x630 PNG. */
  image: string
  imageAlt: string
}

export type PreviewImage = 'default' | 'relay' | 'daily' | 'invite'

const TAGLINE = 'How far can one NIM travel?'
const DEFAULT_DESCRIPTION = 'A living relay game on Nimiq. Receive a real NIM baton, race the last runner’s verified ghost, and pass it on with Nimiq Pay.'
const IMAGE_ALT = 'NIM Relay: a courier carrying a glowing gold baton across a sunset city bridge.'

const MODE_LABEL: Record<string, string> = { global: 'Global Relay', quick: 'Quick Relay', crew: 'Crew Relay', rival: 'Rival Relay' }

function absolute(origin: string, path: string): string {
  return new URL(path, origin).href
}

function imageUrl(origin: string, image: PreviewImage): string {
  return absolute(origin, `/og/${image}.png`)
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function duration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d`
}

export function defaultMeta(origin: string, path: string): PageMeta {
  return {
    title: `NIM Relay · ${TAGLINE}`,
    description: DEFAULT_DESCRIPTION,
    url: absolute(origin, path),
    image: imageUrl(origin, 'default'),
    imageAlt: IMAGE_ALT,
  }
}

/** A journey or Chronicle link: the baton's name, who holds it, and how far it has travelled. Public facts only. */
export function relayMeta(origin: string, path: string, detail: BatonDetail): PageMeta {
  const { baton } = detail
  const identity = `${MODE_LABEL[baton.mode] ?? 'Relay'} #${String(baton.serial).padStart(3, '0')}`
  const name = baton.displayName === identity ? identity : `${baton.displayName} · ${identity}`
  const handoffs = plural(baton.handoffCount, 'verified handoff', 'verified handoffs')
  const where = baton.lineage.countries.length > 0 ? `, ${plural(baton.lineage.countries.length, 'country', 'countries')}` : ''
  const holder = baton.status === 'completed' ? `Finished with ${baton.holder.name}.` : `${baton.holder.name} carries it now.`
  return {
    title: `${name} · NIM Relay`,
    description: `${holder} ${handoffs}${where}, ${duration(baton.aliveMs)} alive. Race the ghost and keep 1 NIM moving.`,
    url: absolute(origin, path),
    image: imageUrl(origin, 'relay'),
    imageAlt: IMAGE_ALT,
  }
}

export function runnerMeta(origin: string, path: string, profile: RunnerProfile): PageMeta {
  return {
    title: `${profile.name} · NIM Relay courier`,
    description: `Level ${profile.level} courier with ${plural(profile.qualifiedHandoffs, 'verified handoff', 'verified handoffs')}. ${TAGLINE}`,
    url: absolute(origin, path),
    image: imageUrl(origin, 'default'),
    imageAlt: IMAGE_ALT,
  }
}

/** Invite links never reveal the token's details to crawlers, and fetching them would count as an invite open. */
export function inviteMeta(origin: string, path: string): PageMeta {
  return {
    title: 'You’re invited to carry the baton · NIM Relay',
    description: 'Someone wants you on their relay. Receive 1 NIM, race their verified ghost, and pass it on with Nimiq Pay.',
    url: absolute(origin, path),
    image: imageUrl(origin, 'invite'),
    imageAlt: IMAGE_ALT,
  }
}

export function dailyMeta(origin: string, path: string): PageMeta {
  return {
    title: 'Daily Relay · NIM Relay',
    description: 'One course for everyone today. One official run, server-verified. Beat the ghost above you on the board.',
    url: absolute(origin, path),
    image: imageUrl(origin, 'daily'),
    imageAlt: IMAGE_ALT,
  }
}

export function proofMeta(origin: string, path: string): PageMeta {
  return {
    title: 'Proof of the relay · NIM Relay',
    description: 'Every handoff is a real Nimiq transfer verified on chain, and every race is replayed by the server. See the transactions and replays.',
    url: absolute(origin, path),
    image: imageUrl(origin, 'default'),
    imageAlt: IMAGE_ALT,
  }
}
