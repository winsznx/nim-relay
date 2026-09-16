import { RelayNetworkService } from './network'
import { DurableObject } from 'cloudflare:workers'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { stationRace } from '@nim-relay/game-engine'
import { deriveCommitment, encodeTxData, paymentAddress, NimiqRpcClient, verifyHandoffTransaction } from '@nim-relay/relay-protocol'
import type { CanonicalGhost, Chronicle, HandoffIntent, IssuedRace, RaceResult, RaceTrace, StationChallenge, StationCrew, StationProfile, StationSnapshot, SubmittedRace } from '@nim-relay/shared'
import type { Env } from '../env'
import type { PlayerRecord } from '../auth/store'
export interface Profile extends StationProfile { wallet: string; rivals: string[]; best: number; bestRunId: string | null; dailyBest: Record<string, number> }
export interface Run { issued: IssuedRace; result: RaceResult; inputTrace: RaceTrace; at: number }
export interface State { players: Record<string, Profile>; crews: StationCrew[]; challenges: StationChallenge[]; chronicles: Chronicle[]; global: StationSnapshot['global']; latest: Record<string, string>; intents: Record<string, HandoffIntent>; usedTx: Record<string, string> }
const worlds = ['coast', 'alpine', 'metro', 'solar', 'ocean'] as const
const cosmetics: StationSnapshot['cosmetics'] = [
  { id: 'solar', category: 'suit', name: 'Solar Courier', xp: 0 }, { id: 'ice', category: 'suit', name: 'Alpine Courier', xp: 500 }, { id: 'midnight', category: 'suit', name: 'Midnight Courier', xp: 1500 },
  { id: 'visor', category: 'helmet', name: 'Flight Visor', xp: 0 }, { id: 'halo', category: 'helmet', name: 'Relay Halo', xp: 1200 },
  { id: 'vector', category: 'board', name: 'Vector Board', xp: 0 }, { id: 'comet', category: 'board', name: 'Comet Board', xp: 750 },
  { id: 'gold', category: 'trail', name: 'Gold Wake', xp: 0 }, { id: 'aurora', category: 'trail', name: 'Aurora Wake', xp: 1000 },
]
const initial = (): State => ({ players: {}, crews: [], challenges: [], chronicles: [], global: { holderId: null, holderName: null, leg: 0, world: 'coast', seed: 'route-coast-v4' }, latest: {}, intents: {}, usedTx: {} })
const issueSchema = z.object({ mode: z.enum(['quick', 'global', 'crew', 'rival', 'daily']), world: z.enum(worlds), target: z.string().max(80).optional() })
const recipientSchema = z.object({ recipient: z.string().min(1).max(80) })
const publicProfile = ({ wallet: _wallet, rivals: _rivals, best: _best, bestRunId: _bestRunId, dailyBest: _dailyBest, ...profile }: Profile): StationProfile => profile
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('')
export async function mac(secret: string, value: unknown) { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify(value)))) }
export function signedFields(issued: IssuedRace) { return { ...(issued.networkRace ? { networkRace: true, batonId: issued.batonId ?? null, practice: issued.practice ?? false } : {}), relayLeg: issued.relayLeg, runId: issued.runId, playerId: issued.playerId, mode: issued.mode, config: issued.config, expiresAt: issued.expiresAt, target: issued.target } }
function equal(a: string, b: string) { if (a.length !== b.length) return false; let difference = 0; for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i); return difference === 0 }
export class ApiError extends Error { constructor(readonly code: string, readonly status = 400) { super(code) } }
export class StationRoom extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') === 'websocket') { const pair = new WebSocketPair(); this.ctx.acceptWebSocket(pair[1]); return new Response(null, { status: 101, webSocket: pair[0] }) }
    return this.ctx.blockConcurrencyWhile(async () => {
      try { return await this.handle(request) } catch (error) { if (error instanceof ApiError) return Response.json({ error: error.code }, { status: error.status }); if (error instanceof z.ZodError) return Response.json({ error: 'bad_request' }, { status: 400 }); console.error('Station request failed', error instanceof Error ? error.message : 'unknown'); return Response.json({ error: 'station_unavailable' }, { status: 503 }) }
    })
  }
  override async webSocketMessage(ws: WebSocket): Promise<void> { ws.send(JSON.stringify({ type: 'refresh' })) }
  override async webSocketClose(): Promise<void> {}
  private async handle(request: Request): Promise<Response> {
    const state = await this.ctx.storage.get<State>('state') ?? initial()
    const path = new URL(request.url).pathname
    if (path === '/public') return Response.json({ global: state.global, chronicles: state.chronicles.slice(-20).reverse(), rankings: this.rankings(state) })
    const { player, body, country } = await request.json() as { player: PlayerRecord; body: unknown; country?: string }
    if (path.startsWith('/network/public') || path.startsWith('/network/batons/') || path.startsWith('/network/replays/') || path.startsWith('/network/invites/')) {
      const service = await RelayNetworkService.load(this.ctx.storage, this.env, state)
      return Response.json(await service.handle(path.slice('/network'.length), body, null, country))
    }
    let profile = state.players[player.id]
    if (!profile) { profile = { id: player.id, name: player.displayName, handle: player.handle, wallet: player.walletAddress, xp: 0, level: 1, seasonRank: 'Cadet', runs: 0, handoffs: 0, achievements: [], unlocked: cosmetics.filter(c => !c.xp).map(c => c.id), equipped: { suit: 'solar', helmet: 'visor', board: 'vector', trail: 'gold' }, crewId: null, rivals: [], best: 0, bestRunId: null, dailyBest: {} }; state.players[player.id] = profile }
    if (path.startsWith('/network')) { const service = await RelayNetworkService.load(this.ctx.storage, this.env, state); const response = await service.handle(path.slice('/network'.length) || '/', body, profile, country); await service.persist(); if (!['/network', '/network/', '/network/heartbeat', '/network/inbox/read'].includes(path)) for (const socket of this.ctx.getWebSockets()) { try { socket.send(JSON.stringify({ type: 'network_updated', version: service.state.version })) } catch { socket.close(1011, 'Reconnect') } } return Response.json(response) }
    const snapshot = () => this.snapshot(state, profile)
    let response: unknown
    if (path === '/') response = snapshot()
    else if (path === '/issue') {
      const input = issueSchema.parse(body)
      if (input.mode === 'crew' && !profile.crewId) throw new ApiError('join_a_crew_first', 409)
      let world = input.world
      let seed = `route-${world}-v4`
      let target = input.target ?? null
      if (target && (input.mode === 'daily' || input.mode === 'global')) throw new ApiError('route_is_fixed')
      if (input.mode === 'daily') { const daily = this.daily(); world = daily.world; seed = daily.seed }
      if (input.mode === 'global') { world = state.global.world; seed = state.global.seed }
      let ghostRun: Run | undefined
      if (input.mode === 'crew') { if (target && target !== profile.crewId) throw new ApiError('crew_not_found', 404); seed = `crew-${profile.crewId}-${world}-v4`; target = null }
      if (target && state.players[target]?.bestRunId) target = state.players[target]!.bestRunId
      if (target) { const challenge = state.challenges.find(c => c.id === target && c.to === player.id); if (challenge) target = challenge.runId; ghostRun = await this.ctx.storage.get<Run>(`run:${target}`); if (!ghostRun) throw new ApiError('challenge_not_found', 404); world = ghostRun.issued.config.world; seed = ghostRun.issued.config.seed }
      else { const runId = state.latest[seed]; if (runId) ghostRun = await this.ctx.storage.get<Run>(`run:${runId}`) }
      if (input.mode === 'rival' && !ghostRun) throw new ApiError('choose_a_verified_ghost', 409)
      const ghost: CanonicalGhost | null = ghostRun ? { runId: ghostRun.issued.runId, name: state.players[ghostRun.issued.playerId]?.name ?? 'Courier', config: ghostRun.issued.config, inputTrace: ghostRun.inputTrace, result: ghostRun.result, verified: true } : null
      const issued: IssuedRace = { relayLeg: input.mode === 'global' ? state.global.leg : null, runId: crypto.randomUUID(), playerId: player.id, mode: input.mode, config: { engineVersion: '4', challenge: 'station-race', challengeVersion: '4', seed, world }, target, expiresAt: Date.now() + 10 * 60_000, mac: '', ghost }
      issued.mac = await mac(this.env.RUN_CHALLENGE_SECRET, signedFields(issued))
      await this.ctx.storage.put(`issue:${issued.runId}`, issued)
      response = issued
    } else if (path === '/submit') {
      const input = z.object({ issued: z.object({ runId: z.string(), mac: z.string() }).passthrough(), inputTrace: z.unknown() }).parse(body)
      const issued = await this.ctx.storage.get<IssuedRace>(`issue:${input.issued.runId}`)
      if (!issued || issued.playerId !== player.id) throw new ApiError('run_not_found', 404)
      if (!equal(input.issued.mac, issued.mac) || !equal(await mac(this.env.RUN_CHALLENGE_SECRET, signedFields(issued)), issued.mac)) throw new ApiError('bad_mac', 401)
      // Every client-supplied signed field must be identical; the stored configuration is replay authority.
      for (const key of ['networkRace', 'batonId', 'practice', 'relayLeg', 'playerId', 'mode', 'config', 'expiresAt', 'target'] as const) if (JSON.stringify(input.issued[key]) !== JSON.stringify(issued[key])) throw new ApiError('bad_mac', 401)
      const previous = await this.ctx.storage.get<Run>(`run:${issued.runId}`)
      if (previous) response = { runId: issued.runId, result: previous.result, created: false, xpEarned: 0, profile: publicProfile(profile), qualifiedHandoff: this.qualified(state, profile, previous) } satisfies SubmittedRace
      else {
        if (Date.now() > issued.expiresAt) throw new ApiError('run_expired', 410)
        const checked = stationRace.validateTrace(input.inputTrace)
        if (!checked.ok) throw new ApiError('invalid_trace')
        const result = stationRace.replay({ ...issued.config, inputTrace: checked.trace })
        const run: Run = { issued, result, inputTrace: checked.trace, at: Date.now() }
        const networkService = issued.networkRace ? await RelayNetworkService.load(this.ctx.storage, this.env, state) : null
        if (networkService) await networkService.onRun(run, profile)
        const xpEarned = issued.practice ? 0 : result.completed ? 100 + Math.min(150, Math.floor(result.score / 100)) : 20
        if (!issued.practice) {
        profile.xp += xpEarned; profile.runs++; if (result.score > profile.best) { profile.best = result.score; profile.bestRunId = issued.runId }
        if (issued.mode === 'daily') profile.dailyBest[issued.config.seed] = Math.max(profile.dailyBest[issued.config.seed] ?? 0, result.score)
        this.progress(profile)
        if (result.completed && !profile.achievements.includes('First arrival')) profile.achievements.push('First arrival')
        if (result.completed && issued.ghost && result.timeMs < issued.ghost.result.timeMs && !profile.achievements.includes('Ghost hunter')) profile.achievements.push('Ghost hunter')
        if (!issued.networkRace && issued.mode === 'global' && result.completed && state.global.holderId === null) { state.global.holderId = player.id; state.global.holderName = profile.name }
        state.latest[issued.config.seed] = issued.runId
        for (const challenge of state.challenges) if (challenge.to === player.id && challenge.runId === issued.target && result.completed) challenge.status = 'completed'
        state.chronicles.push({ id: issued.runId, kind: 'run', name: profile.name, at: run.at, world: issued.config.world, score: result.score, leg: state.global.leg }); state.chronicles = state.chronicles.slice(-100)
        }
        await this.ctx.storage.transaction(async storage => { await storage.put(`run:${issued.runId}`, run); await storage.put('state', state); await storage.put(`archive:${issued.runId}`, run); if (networkService) await networkService.writeTo(storage) })
        await this.ctx.storage.setAlarm(Date.now() + 1000)
        response = { runId: issued.runId, result, created: true, xpEarned, profile: publicProfile(profile), qualifiedHandoff: this.qualified(state, profile, run) } satisfies SubmittedRace
      }
    } else if (path === '/crew/create') {
      const { name } = z.object({ name: z.string().trim().min(3).max(28) }).parse(body)
      if (profile.crewId) throw new ApiError('already_in_a_crew', 409)
      const crew = { id: crypto.randomUUID(), name, code: crypto.randomUUID().slice(0, 8).toUpperCase(), members: [player.id] }; state.crews.push(crew); profile.crewId = crew.id; response = snapshot()
    } else if (path === '/crew/join') {
      const { code } = z.object({ code: z.string().trim().max(20) }).parse(body)
      const crew = state.crews.find(c => c.code === code.toUpperCase()); if (!crew) throw new ApiError('crew_not_found', 404)
      if (profile.crewId && profile.crewId !== crew.id) throw new ApiError('already_in_a_crew', 409)
      if (!crew.members.includes(player.id)) crew.members.push(player.id); profile.crewId = crew.id; response = snapshot()
    } else if (path === '/rival' || path === '/challenge') {
      const { recipient } = recipientSchema.parse(body); const other = this.recipient(state, recipient, profile)
      if (path === '/rival') { if (!profile.rivals.includes(other.id)) profile.rivals.push(other.id) }
      else { const { runId } = z.object({ runId: z.string() }).parse(body); const run = await this.ctx.storage.get<Run>(`run:${runId}`); if (!run || run.issued.playerId !== player.id || !run.result.completed) throw new ApiError('finish_a_verified_run_first', 409); if (!state.challenges.some(c => c.from === player.id && c.to === other.id && c.runId === runId)) state.challenges.push({ id: crypto.randomUUID(), from: player.id, fromName: profile.name, to: other.id, runId, status: 'pending', createdAt: Date.now() }) }
      response = snapshot()
    } else if (path === '/profile') {
      const input = z.object({ name: z.string().trim().min(2).max(24).optional(), category: z.enum(['suit', 'helmet', 'board', 'trail']).optional(), cosmetic: z.string().optional() }).parse(body)
      if (input.name) profile.name = input.name
      if (input.category && input.cosmetic) { const cosmetic = cosmetics.find(c => c.id === input.cosmetic && c.category === input.category); if (!cosmetic || cosmetic.xp > profile.xp) throw new ApiError('cosmetic_locked', 403); profile.equipped[input.category] = cosmetic.id }
      response = snapshot()
    } else if (path === '/handoff/prepare') {
      const input = z.object({ runId: z.string(), recipient: z.string(), throw: z.object({ angle: z.number().int().min(15).max(75), power: z.number().int().min(30).max(100) }).default({ angle: 45, power: 75 }) }).parse(body)
      const run = await this.ctx.storage.get<Run>(`run:${input.runId}`)
      if (!run || run.issued.playerId !== player.id || !this.qualified(state, profile, run)) throw new ApiError('baton_not_ready', 409)
      const recipient = this.recipient(state, input.recipient, profile)
      const existing = Object.values(state.intents).find(i => i.leg === state.global.leg + 1 && i.status === 'pending')
      if (existing) { if (existing.runId !== input.runId || existing.recipientId !== recipient.id) throw new ApiError('handoff_already_prepared', 409); response = existing }
      else { const id = crypto.randomUUID(); const commitment = await deriveCommitment(await mac(this.env.RUN_CHALLENGE_SECRET, { id, throw: input.throw, run: input.runId, sender: profile.id, recipient: recipient.id, leg: state.global.leg + 1 })); const intent: HandoffIntent = { id, throw: input.throw, runId: input.runId, recipientId: recipient.id, recipientName: recipient.name, sender: paymentAddress(profile.wallet), recipient: paymentAddress(recipient.wallet), value: 100000, data: encodeTxData({ relayCode: 'GLOBAL', legNumber: state.global.leg + 1, commitment }), network: this.env.NIMIQ_NETWORK, leg: state.global.leg + 1, status: 'pending', txHash: null }; state.intents[id] = intent; response = intent }
    } else if (path === '/handoff/confirm') {
      const { id, txHash } = z.object({ id: z.string(), txHash: z.string().regex(/^[0-9a-fA-F]{64}$/).transform(s => s.toLowerCase()) }).parse(body)
      const intent = state.intents[id]
      if (!intent || intent.sender !== paymentAddress(profile.wallet)) throw new ApiError('handoff_not_found', 404)
      if (intent.status === 'verified') { if (intent.txHash !== txHash) throw new ApiError('different_transaction', 409); response = { status: 'verified', intent } }
      else {
        if (state.usedTx[txHash] && state.usedTx[txHash] !== id) throw new ApiError('transaction_already_used', 409)
        if (state.global.holderId !== player.id || intent.leg !== state.global.leg + 1) throw new ApiError('custody_changed', 409)
        intent.txHash = txHash
        try {
          const tx = await new NimiqRpcClient({ rpcUrl: this.env.NIMIQ_RPC_URL }).getTransactionByHash(txHash)
          const verification = verifyHandoffTransaction(tx, { senderWallet: intent.sender, recipientWallet: intent.recipient, valueLuna: BigInt(intent.value), relayCode: 'GLOBAL', legNumber: intent.leg, commitment: intent.data.split('.')[3]!, network: intent.network, minConfirmations: 2 })
          if (!verification.ok) response = { status: ['NOT_INCLUDED', 'INSUFFICIENT_CONFIRMATIONS'].includes(verification.reason) ? 'pending' : 'rejected', reason: verification.reason }
          else {
            intent.status = 'verified'; intent.txHash = txHash; state.usedTx[txHash] = id; state.global.holderId = intent.recipientId; state.global.holderName = state.players[intent.recipientId]!.name; state.global.leg = intent.leg; state.global.world = worlds[intent.leg % worlds.length]!; state.global.seed = `route-${state.global.world}-v4`
            profile.handoffs++; profile.xp += 250; if (!profile.achievements.includes('Baton bearer')) profile.achievements.push('Baton bearer'); this.progress(profile)
            state.chronicles.push({ id, kind: 'handoff', name: profile.name, world: state.global.world, at: Date.now(), score: 0, leg: intent.leg }); state.chronicles = state.chronicles.slice(-100); response = { status: 'verified', intent }
          }
        } catch { response = { status: 'pending', reason: 'Awaiting network confirmation' } }
      }
    } else throw new ApiError('not_found', 404)
    await this.ctx.storage.put('state', state)
    return Response.json(response)
  }
  override async alarm(): Promise<void> {
    const product = await this.ctx.storage.get<State>('state') ?? initial()
    const networkService = await RelayNetworkService.load(this.ctx.storage, this.env, product)
    await networkService.reconcile()
    if (!this.env.SUPABASE_URL || !this.env.SUPABASE_SERVICE_ROLE_KEY) return
    const pending = await this.ctx.storage.list<Run>({ prefix: 'archive:', limit: 20 })
    const client = createClient(this.env.SUPABASE_URL, this.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    for (const [key, run] of pending) {
      const { error } = await client.from('station_races').upsert({ id: run.issued.runId, player_id: run.issued.playerId, mode: run.issued.mode, config: run.issued.config, input_trace: run.inputTrace, result: run.result, verified_at: new Date(run.at).toISOString() }, { onConflict: 'id', ignoreDuplicates: true })
      if (error) { console.error('Station archive deferred', error.code); await this.ctx.storage.setAlarm(Date.now() + 60000); return }
      await this.ctx.storage.delete(key)
    }
    if (pending.size === 20) await this.ctx.storage.setAlarm(Date.now() + 1000)
  }
  private qualified(state: State, profile: Profile, run: Run) { if (run.issued.networkRace) return Boolean(run.issued.batonId && run.result.completed && !run.issued.practice); return run.result.completed && run.issued.mode === 'global' && run.issued.relayLeg === state.global.leg && state.global.holderId === profile.id && run.issued.config.seed === state.global.seed }
  private recipient(state: State, value: string, profile: Profile): Profile { const other = Object.values(state.players).find(p => p.id === value || p.handle.toLowerCase() === value.trim().replace(/^@/, '').toLowerCase()); if (!other) throw new ApiError('courier_not_found', 404); if (other.id === profile.id) throw new ApiError('choose_another_courier'); return other }
  private progress(profile: Profile) { profile.level = 1 + Math.floor(profile.xp / 500); profile.seasonRank = profile.xp >= 5000 ? 'Legend' : profile.xp >= 2000 ? 'Vanguard' : profile.xp >= 500 ? 'Courier' : 'Cadet'; profile.unlocked = cosmetics.filter(c => c.xp <= profile.xp).map(c => c.id); if (profile.runs >= 10 && !profile.achievements.includes('Ten journeys')) profile.achievements.push('Ten journeys') }
  private daily() { const date = new Date().toISOString().slice(0, 10); return { date, world: worlds[Math.floor(Date.now() / 86400000) % 5]!, seed: `daily-${date}-v4`, best: null } }
  private rankings(state: State) { return Object.values(state.players).filter(p => p.runs > 0).sort((a, b) => b.best - a.best).slice(0, 50).map(p => ({ id: p.id, name: p.name, score: p.best, xp: p.xp })) }
  private snapshot(state: State, profile: Profile): StationSnapshot { return { pendingHandoff: Object.values(state.intents).find(i => i.status === 'pending' && i.sender === paymentAddress(profile.wallet)) ?? null, profile: publicProfile(profile), global: state.global, daily: { ...this.daily(), best: profile.dailyBest[this.daily().seed] ?? null }, crews: state.crews.filter(c => c.members.includes(profile.id)), rivals: profile.rivals.map(id => state.players[id]).filter((p): p is Profile => !!p).map(p => ({ id: p.id, name: p.name, score: p.best })), inbox: state.challenges.filter(c => c.to === profile.id).slice(-50).reverse(), rankings: this.rankings(state), chronicles: state.chronicles.slice(-30).reverse(), cosmetics } }
}
