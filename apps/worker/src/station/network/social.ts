import type { BatonDetail, NetworkInvite } from '@nim-relay/shared'
import { z } from 'zod'
import { ApiError, type Profile } from '../model'
import { sha256Hex } from '../signing'
import { batonDetail, createBaton } from './batons'
import { INVITE_TTL_MS, MAX_ACTIVE_INVITES, MAX_CREW_MEMBERS, RIVALRY_MS } from './constants'
import { shortCode } from './identity'
import { assertHolder, findBaton, notify, openIntentFor } from './lookups'
import { isObservableCountry, networkRunner, requireCourier } from './runners'
import type { Member, NetworkContext } from './types'

const batonBody = z.object({ batonId: z.string() })

export async function createInvite(context: NetworkContext, profile: Profile, body: unknown): Promise<NetworkInvite> {
  const baton = findBaton(context.state, batonBody.parse(body).batonId)
  assertHolder(baton, profile)
  const now = Date.now()
  const activeInvites = Object.values(context.state.invites).filter(invite => invite.from.id === profile.id && invite.expiresAt > now)
  if (activeInvites.length >= MAX_ACTIVE_INVITES) throw new ApiError('too_many_active_invites', 429)
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  const invite: NetworkInvite = {
    id: crypto.randomUUID(),
    token,
    batonId: baton.id,
    from: networkRunner(context.state, profile),
    recipientId: baton.recipientId,
    createdAt: now,
    expiresAt: now + INVITE_TTL_MS,
    claimedBy: null,
    url: `${context.env.APP_ORIGIN}/invite/${token}`,
  }
  // Only the hash is kept: a stored invitation can never be replayed from state or archives.
  context.state.invites[await sha256Hex(token)] = { ...invite, token: '', url: '' }
  return invite
}

export async function findInvite(context: NetworkContext, token: string): Promise<{ invite: NetworkInvite; tokenHash: string }> {
  const tokenHash = await sha256Hex(token)
  const invite = context.state.invites[tokenHash]
  if (!invite) throw new ApiError('invite_not_found', 404)
  if (invite.expiresAt < Date.now()) throw new ApiError('invite_expired', 410)
  return { invite, tokenHash }
}

export async function claimInvite(context: NetworkContext, profile: Profile, body: unknown): Promise<BatonDetail> {
  const { token } = z.object({ token: z.string() }).parse(body)
  const now = Date.now()
  const invite = context.state.invites[await sha256Hex(token)]
  if (!invite || invite.expiresAt < now) throw new ApiError('invite_expired', 410)
  if (invite.claimedBy && invite.claimedBy !== profile.id) throw new ApiError('invite_already_claimed', 409)
  if (invite.from.id === profile.id) throw new ApiError('invite_is_for_another_courier')
  if (invite.recipientId && invite.recipientId !== profile.id) throw new ApiError('invite_is_for_another_courier', 403)
  const baton = findBaton(context.state, invite.batonId)
  if (baton.holder.id !== invite.from.id || baton.status === 'completed') throw new ApiError('invite_no_longer_current', 410)
  // Addressed to the invitee: the open pass is the holder's to finish, or to let expire.
  if (openIntentFor(context.state, baton.id)) throw new ApiError('holder_pass_in_progress', 409)
  invite.claimedBy = profile.id
  baton.recipientId = profile.id
  baton.recipientReservedAt = now
  baton.recipientAcceptedAt = now
  notify(context.state, baton.holder.id, { type: 'your_turn', title: `${profile.name} accepted`, body: 'Your next runner is ready for the baton.', batonId: baton.id })
  return batonDetail(context, baton, profile)
}

/** The reserved runner confirms they will take the next pass, which keeps the reservation from lapsing. */
export async function acceptReservation(context: NetworkContext, profile: Profile, body: unknown): Promise<BatonDetail> {
  const baton = findBaton(context.state, batonBody.parse(body).batonId)
  if (baton.recipientId !== profile.id || baton.status === 'completed') throw new ApiError('not_reserved_for_you', 403)
  if (baton.recipientAcceptedAt === null) {
    baton.recipientAcceptedAt = Date.now()
    notify(context.state, baton.holder.id, { type: 'your_turn', title: `${profile.name} accepted`, body: `${baton.displayName} is ready for the next pass.`, batonId: baton.id })
  }
  return batonDetail(context, baton, profile)
}

export function createCrew(context: NetworkContext, profile: Profile, body: unknown): void {
  const { name } = z.object({ name: z.string().trim().min(3).max(28) }).parse(body)
  if (profile.crewId) throw new ApiError('already_in_a_crew', 409)
  const crew = { id: crypto.randomUUID(), name, code: shortCode(), members: [profile.id] }
  context.product.crews.push(crew)
  profile.crewId = crew.id
}

export function joinCrew(context: NetworkContext, profile: Profile, body: unknown): void {
  const { code } = z.object({ code: z.string() }).parse(body)
  const crew = context.product.crews.find(candidate => candidate.code === code.trim().toUpperCase())
  if (!crew) throw new ApiError('crew_not_found', 404)
  if (profile.crewId && profile.crewId !== crew.id) throw new ApiError('already_in_a_crew', 409)
  if (!crew.members.includes(profile.id)) {
    if (crew.members.length >= MAX_CREW_MEMBERS) throw new ApiError('crew_is_full', 409)
    crew.members.push(profile.id)
  }
  profile.crewId = crew.id
}

/** Two independent team batons; the first to the target handoff count wins. */
export function createRivalry(context: NetworkContext, profile: Profile, body: unknown): void {
  const input = z.object({ title: z.string().trim().min(3).max(60), opponent: z.string(), target: z.number().int().min(2).max(50).default(10) }).parse(body)
  const opponent = requireCourier(context.product, input.opponent, profile)
  const now = Date.now()
  const id = crypto.randomUUID()
  const home = createBaton(context, profile, { mode: 'rival', title: `${input.title} · ${profile.name}` })
  const away = createBaton(context, opponent, { mode: 'rival', title: `${input.title} · ${opponent.name}` })
  home.rivalId = id
  away.rivalId = id
  context.state.rivals.push({ id, title: input.title, batonIds: [home.id, away.id], target: input.target, scores: [0, 0], winnerId: null, createdAt: now, endsAt: now + RIVALRY_MS })
  notify(context.state, opponent.id, { type: 'rival_update', title: `${profile.name} started a rivalry`, body: input.title, batonId: away.id })
}

export function markNotificationRead(context: NetworkContext, profile: Profile, body: unknown): void {
  const { id } = z.object({ id: z.string().uuid() }).parse(body)
  const notification = context.state.notifications[profile.id]?.find(candidate => candidate.id === id)
  if (notification) notification.readAt = Date.now()
}

export function setCountryConsent(member: Member, body: unknown, country: string | undefined): void {
  member.consent = z.object({ consent: z.boolean() }).parse(body).consent
  if (!member.consent) member.country = null
  else if (isObservableCountry(country)) member.country = country
}

/** Foreground time accrues only as fast as real time between authenticated heartbeats, at most 30 seconds each. */
export function recordHeartbeat(member: Member, body: unknown, now: number): void {
  const { seconds } = z.object({ seconds: z.number().int().min(0).max(30) }).parse(body)
  const elapsedSeconds = Math.max(0, Math.floor((now - member.lastHeartbeat) / 1000))
  member.foreground += Math.min(seconds, elapsedSeconds, 30)
  member.lastHeartbeat = now
}
