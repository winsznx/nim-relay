import { paymentAddress } from '@nim-relay/relay-protocol'
import type { NetworkRunner, RunnerRef } from '@nim-relay/shared'
import { ApiError, type Profile, type State } from '../model'
import { utcDate } from './calendar'
import type { Member, NetworkState } from './types'

const UNKNOWN_COUNTRY_CODES = ['XX', 'T1']

export function isObservableCountry(country: string | undefined): country is string {
  return country !== undefined && /^[A-Z]{2}$/.test(country) && !UNKNOWN_COUNTRY_CODES.includes(country)
}

export function consentedCountry(state: NetworkState, playerId: string): string | null {
  const member = state.members[playerId]
  return member?.consent ? member.country : null
}

export function networkRunner(state: NetworkState, profile: Profile): NetworkRunner {
  const country = consentedCountry(state, profile.id)
  return {
    id: profile.id,
    name: profile.name,
    handle: profile.handle,
    wallet: paymentAddress(profile.wallet),
    country,
    countrySource: country ? 'network_observed' : null,
  }
}

export function runnerRef(runner: { id: string; handle: string; name: string }): RunnerRef {
  return { id: runner.id, handle: runner.handle, name: runner.name }
}

export function findCourier(product: State, idOrHandle: string): Profile | undefined {
  const handle = idOrHandle.trim().replace(/^@/, '').toLowerCase()
  return Object.values(product.players).find(player => player.id === idOrHandle || player.handle.toLowerCase() === handle)
}

export function requireCourier(product: State, idOrHandle: string, sender: Profile): Profile {
  const courier = findCourier(product, idOrHandle)
  if (!courier) throw new ApiError('courier_not_found', 404)
  if (sameWallet(courier, sender)) throw new ApiError('choose_another_courier')
  return courier
}

export function sameWallet(a: Profile, b: Profile): boolean {
  return paymentAddress(a.wallet) === paymentAddress(b.wallet)
}

export function memberFor(state: NetworkState, playerId: string, now: number): Member {
  const existing = state.members[playerId]
  if (existing) return existing
  const member: Member = { consent: false, country: null, firstSeen: now, lastSeen: now, days: [], foreground: 0, lastHeartbeat: now, completedRuns: 0, legs: 0, legMarks: {} }
  state.members[playerId] = member
  return member
}

/** Records an authenticated visit: returning-day activity and, with consent, the network-observed country. */
export function touchMember(state: NetworkState, playerId: string, country: string | undefined, now: number): Member {
  const member = memberFor(state, playerId, now)
  member.lastSeen = now
  const today = utcDate(now)
  if (!member.days.includes(today)) member.days.push(today)
  if (member.consent && isObservableCountry(country)) member.country = country
  return member
}
