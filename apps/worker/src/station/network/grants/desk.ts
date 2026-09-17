import { paymentAddress, signBasicTransfer } from '@nim-relay/relay-protocol'
import { GRANT_MILESTONE_IDS, type GrantAbuseReason, type GrantClaimResult, type GrantMilestoneId, type GrantMilestoneView, type GrantRefusal, type GrantsOpsReport, type GrantsSummary, type GrantsView } from '@nim-relay/shared'
import { z } from 'zod'
import type { PlayerRecord } from '../../../auth/store'
import type { Env } from '../../../env'
import { ApiError } from '../../model'
import { BATON_VALUE_LUNA, RECONCILE_RETRY_MS } from '../constants'
import { isOperator } from '../ops'
import { networkMetrics } from '../metrics'
import type { RelayNetworkService } from '../service'
import { networkStateKey } from '../state'
import type { NetworkContext } from '../types'
import { broadcast, lookUpGrant, readClaimFacts, readWalletBalance, type ClaimChainFacts, type GrantEvidence } from './chain'
import { TRANSACTION_CEILING_LUNA, treasuryConfig, treasuryKey, type TreasuryConfig } from './config'
import { meetsRequirement, MILESTONE_COPY, socialReferrals, crewMilestone } from './eligibility'
import {
  charge,
  chargedToday,
  countClaimAttempt,
  deviceChargeKey,
  grantId,
  grantRecordKey,
  grantsKey,
  holdsReservation,
  isOpenGrant,
  logAbuse,
  MAX_FAILED_ATTEMPTS,
  readCharge,
  readLedger,
  readRecords,
  release,
  walletChargeKey,
  type ChargeRecord,
  type GrantLedger,
  type GrantRecord,
} from './ledger'
import { createStarterBaton } from './starter-baton'

/** Claim attempts one runner may make per UTC day; idempotent repeats of an open or confirmed grant are not counted. */
export const GRANT_CLAIMS_PER_PLAYER_PER_DAY = 20
/** Open grants looked up on chain per alarm run. */
export const MAX_GRANT_LOOKUPS = 10
/** A wallet balance read for the starter offer is reused this long. */
const WALLET_BALANCE_TTL_MS = 2 * 60_000
/** How often a runner's own view may look an open grant up on chain. */
export const OWN_CHECK_INTERVAL_MS = 4_000

const claimBody = z.object({ grantId: z.enum(GRANT_MILESTONE_IDS) }).strict()
const pauseBody = z.object({ paused: z.boolean() }).strict()

const ABUSE_REFUSALS: readonly GrantAbuseReason[] = ['no_device_signal', 'wallet_already_claimed', 'device_already_claimed', 'participant_cap_reached', 'too_many_grant_claims']

function isAbuseRefusal(refusal: GrantRefusal | null): refusal is GrantAbuseReason & GrantRefusal {
  return ABUSE_REFUSALS.some(reason => reason === refusal)
}

const REFUSAL_STATUS: Partial<Record<GrantRefusal, number>> = { too_many_grant_claims: 429, treasury_unavailable: 503, wallet_balance_unknown: 503 }

/** What the room lends the desk: its storage, and its critical section with a fresh network load inside. */
export interface GrantRoom {
  storage: DurableObjectStorage
  env: Env
  exclusively<T>(work: () => Promise<T>): Promise<T>
  loadNetwork(): Promise<RelayNetworkService>
}

export interface Claimant {
  player: PlayerRecord
  deviceHash: string | null
}

interface ClaimScope {
  context: NetworkContext
  ledger: GrantLedger
  record: GrantRecord | undefined
  wallet: ChargeRecord
  device: ChargeRecord | null
}

/**
 * Relay Grants inside the StationRoom. Every cap is checked in the critical section that records the reservation;
 * chain reads and broadcasts happen between critical sections, as handoff checks do.
 */
export class GrantDesk {
  private readonly base: string
  private readonly walletBalances = new Map<string, { luna: number; at: number }>()
  /** Grant id -> when its runner's view last looked it up. In memory only: a restart allows one extra lookup. */
  private readonly ownChecks = new Map<string, number>()

  constructor(private readonly room: GrantRoom) {
    this.base = grantsKey(networkStateKey(room.env.NIMIQ_NETWORK))
  }

  async view(claimant: Claimant): Promise<GrantsView> {
    const config = await treasuryConfig(this.room.env)
    const wallet = paymentAddress(claimant.player.walletAddress)
    await this.checkOwnGrants(claimant, config)
    const walletLuna = config.enabled ? await this.walletBalance(wallet) : null
    return this.room.exclusively(async () => {
      const network = await this.room.loadNetwork()
      return this.presentView(network.networkContext, config, claimant, walletLuna)
    })
  }

  async claim(claimant: Claimant, body: unknown): Promise<GrantClaimResult> {
    const { grantId: milestone } = claimBody.parse(body)
    const { player } = claimant
    const config = await treasuryConfig(this.room.env)
    const wallet = paymentAddress(player.walletAddress)
    const now = Date.now()

    const precheck = await this.room.exclusively(async () => {
      const scope = await this.scope((await this.room.loadNetwork()).networkContext, claimant, milestone, now)
      if (scope.record && holdsReservation(scope.record)) return { done: true as const }
      const refusal = countClaimAttempt(scope.ledger, player.id, GRANT_CLAIMS_PER_PLAYER_PER_DAY, now)
        ? await this.refusal(scope, config, claimant, milestone, null, now)
        : 'too_many_grant_claims'
      await this.noteRefusal(scope.ledger, refusal, milestone, claimant, now)
      await this.room.storage.put(this.base, scope.ledger)
      return { done: false as const, refusal }
    })
    if (!precheck.done) {
      if (precheck.refusal) throw refusalError(precheck.refusal)
      const facts = config.treasuryAddress ? await readClaimFacts(this.room.env, config.treasuryAddress, milestone === 'starter' ? wallet : null) : null
      if (!facts) throw refusalError('treasury_unavailable')
      if (facts.walletLuna !== null) this.walletBalances.set(wallet, { luna: facts.walletLuna, at: now })
      const prepared = await this.room.exclusively(() => this.reserve(claimant, config, milestone, facts))
      if ('refusal' in prepared) throw refusalError(prepared.refusal)
      if (prepared.fresh && (await broadcast(this.room.env, prepared.record))) await this.markBroadcast(prepared.record)
    }
    return this.room.exclusively(async () => {
      const network = await this.room.loadNetwork()
      const grants = await this.presentView(network.networkContext, config, claimant, this.cachedBalance(wallet))
      const view = grants.milestones.find(item => item.id === milestone)
      if (!view) throw new ApiError('grant_not_found', 404)
      return { milestone: view, grants }
    })
  }

  async summary(): Promise<GrantsSummary> {
    const config = await treasuryConfig(this.room.env)
    const now = Date.now()
    const ledger = await readLedger(this.room.storage, this.base, now)
    const smallest = Math.min(...GRANT_MILESTONE_IDS.map(id => config.amounts[id])) + config.feeLuna
    const remaining = Math.min(config.caps.dailyLuna - chargedToday(ledger, now), config.caps.globalLuna - ledger.globalLuna)
    return {
      network: config.network,
      enabled: config.enabled,
      paused: ledger.paused !== null,
      grants: ledger.counts.created - ledger.counts.controlledCreated,
      confirmed: ledger.counts.confirmed - ledger.counts.controlledConfirmed,
      grantedLuna: ledger.confirmedLuna - ledger.controlledConfirmedLuna,
      headroom: !config.enabled || remaining < smallest ? 'exhausted' : remaining < config.caps.dailyLuna / 5 ? 'low' : 'open',
      lowBalance: lowBalance(ledger, config),
    }
  }

  /** Operators only. The pause takes effect for the next claim and the next rebroadcast, before any other check. */
  async setPaused(player: PlayerRecord, body: unknown): Promise<GrantsOpsReport> {
    this.requireOperator(player)
    const { paused } = pauseBody.parse(body)
    await this.room.exclusively(async () => {
      const ledger = await readLedger(this.room.storage, this.base, Date.now())
      ledger.paused = paused ? (ledger.paused ?? { at: Date.now(), by: player.handle }) : null
      await this.room.storage.put(this.base, ledger)
    })
    return this.opsReport(player)
  }

  async opsReport(player: PlayerRecord): Promise<GrantsOpsReport> {
    this.requireOperator(player)
    const config = await treasuryConfig(this.room.env)
    return this.room.exclusively(async () => {
      const now = Date.now()
      const network = await this.room.loadNetwork()
      const context = network.networkContext
      const ledger = await readLedger(this.room.storage, this.base, now)
      const records = await readRecords(this.room.storage, this.base, ledger.recent)
      const open = await readRecords(this.room.storage, this.base, ledger.open)
      const metrics = networkMetrics(context)
      const controlledWallets = Object.values(context.product.players).filter(profile => isOperator(this.room.env.OPS_PLAYERS, profile)).length
      return {
        network: config.network,
        configured: config.enabled,
        configProblem: config.problem,
        enabled: config.enabled,
        paused: ledger.paused !== null,
        pausedAt: ledger.paused?.at ?? null,
        pausedBy: ledger.paused?.by ?? null,
        treasuryAddress: config.treasuryAddress,
        balanceLuna: ledger.treasury?.balanceLuna ?? null,
        balanceAt: ledger.treasury?.at ?? null,
        lowBalance: lowBalance(ledger, config),
        caps: config.caps,
        amounts: config.amounts,
        spent: { todayLuna: chargedToday(ledger, now), globalLuna: ledger.globalLuna },
        counts: {
          prepared: open.filter(record => record.state === 'prepared').length,
          broadcast: open.filter(record => record.state === 'broadcast').length,
          confirmed: ledger.counts.confirmed,
          failed: ledger.counts.failed,
        },
        separation: {
          treasuryGrantTransactions: ledger.counts.created - ledger.counts.controlledCreated,
          controlledGrantTransactions: ledger.counts.controlledCreated,
          qualifiedRelayHandoffs: metrics.qualifiedHandoffs,
          transactingWallets: metrics.transactingWallets,
          linkedWallets: metrics.linkedWallets,
          controlledWallets,
        },
        recent: records.map(record => ({ milestone: record.milestone, handle: record.handle, controlled: record.controlled, state: record.state, luna: record.luna, txHash: record.txHash, failure: record.failure, at: record.updatedAt })),
        abuse: ledger.abuse,
      }
    })
  }

  hasOpenGrants(): Promise<boolean> {
    return readLedger(this.room.storage, this.base, Date.now()).then(ledger => ledger.open.length > 0)
  }

  /** Alarm work outside the critical section: look every open grant up, and send its signed bytes again when due. */
  async gatherEvidence(): Promise<GrantEvidence[]> {
    const now = Date.now()
    const ledger = await readLedger(this.room.storage, this.base, now)
    if (ledger.open.length === 0) return []
    const config = await treasuryConfig(this.room.env)
    const mayBroadcast = config.enabled && ledger.paused === null
    const records = await readRecords(this.room.storage, this.base, ledger.open.slice(0, MAX_GRANT_LOOKUPS))
    const evidence: GrantEvidence[] = []
    for (const record of records) if (isOpenGrant(record)) evidence.push(await lookUpGrant(this.room.env, record, record.sender, mayBroadcast, now))
    return evidence
  }

  /**
   * Applies chain evidence inside the critical section, to grants that still carry the hash the evidence was read
   * for. A confirmed starter grant creates its baton in the same storage transaction. Returns whether grants remain open.
   */
  async applyEvidence(network: RelayNetworkService, evidence: readonly GrantEvidence[]): Promise<boolean> {
    const now = Date.now()
    const storage = this.room.storage
    const ledger = await readLedger(storage, this.base, now)
    const writes = new Map<string, unknown>()
    let networkChanged = false
    for (const item of evidence) {
      const record = await storage.get<GrantRecord>(grantRecordKey(this.base, item.id))
      if (!record || !isOpenGrant(record) || record.txHash !== item.txHash) continue
      const { outcome } = item
      if (item.rebroadcastAt !== null) {
        record.lastBroadcastAt = item.rebroadcastAt
        if (record.state === 'prepared') record.state = 'broadcast'
      }
      if (outcome.kind === 'included') {
        record.state = 'broadcast'
        record.confirmations = outcome.confirmations
        record.blockNumber = outcome.blockNumber
      } else if (outcome.kind === 'confirmed') {
        record.state = 'confirmed'
        record.confirmations = outcome.confirmations
        record.blockNumber = outcome.blockNumber
        ledger.counts.confirmed++
        ledger.confirmedLuna += record.luna
        if (record.controlled) {
          ledger.counts.controlledConfirmed++
          ledger.controlledConfirmedLuna += record.luna
        }
        if (record.milestone === 'starter') {
          record.batonId = createStarterBaton(network.networkContext, record, now)
          networkChanged ||= record.batonId !== null
        }
      } else if (outcome.kind === 'failed') {
        record.state = 'failed'
        record.failure = outcome.failure
        ledger.counts.failed++
        if (outcome.failure === 'CHAIN_MISMATCH') {
          await logAbuse(ledger, { reason: 'chain_mismatch', milestone: record.milestone, wallet: record.recipient, deviceHash: record.deviceHash }, now)
        } else {
          const walletKey = walletChargeKey(this.base, record.recipient)
          const deviceKey = deviceChargeKey(this.base, record.deviceHash)
          const wallet = (writes.get(walletKey) as ChargeRecord | undefined) ?? (await readCharge(storage, walletKey))
          const device = (writes.get(deviceKey) as ChargeRecord | undefined) ?? (await readCharge(storage, deviceKey))
          release(ledger, wallet, device, record)
          writes.set(walletKey, wallet)
          writes.set(deviceKey, device)
        }
      } else if (item.rebroadcastAt === null) {
        continue
      }
      if (!isOpenGrant(record)) ledger.open = ledger.open.filter(id => id !== record.id)
      record.updatedAt = now
      writes.set(grantRecordKey(this.base, record.id), record)
    }
    if (writes.size === 0) return ledger.open.length > 0
    writes.set(this.base, ledger)
    const write = async (transaction: DurableObjectTransaction) => {
      for (const [key, value] of writes) await transaction.put(key, value)
    }
    if (networkChanged) await network.persist(false, write)
    else await storage.transaction(write)
    return ledger.open.length > 0
  }

  /**
   * A runner watching their own open grant has it looked up on chain now, at most once per OWN_CHECK_INTERVAL_MS per
   * grant, the way a holder checks a pass. The alarm does the same for everyone, but open apps keep pushing it back.
   */
  private async checkOwnGrants(claimant: Claimant, config: TreasuryConfig): Promise<void> {
    const now = Date.now()
    const ids = GRANT_MILESTONE_IDS.map(id => grantId(id, claimant.player.id))
    const records = await readRecords(this.room.storage, this.base, ids)
    for (const record of records) if (!isOpenGrant(record)) this.ownChecks.delete(record.id)
    const due = records.filter(record => isOpenGrant(record) && now - (this.ownChecks.get(record.id) ?? 0) >= OWN_CHECK_INTERVAL_MS)
    if (due.length === 0) return
    const ledger = await readLedger(this.room.storage, this.base, now)
    const evidence: GrantEvidence[] = []
    for (const record of due) {
      this.ownChecks.set(record.id, now)
      evidence.push(await lookUpGrant(this.room.env, record, record.sender, config.enabled && ledger.paused === null, now))
    }
    await this.room.exclusively(async () => this.applyEvidence(await this.room.loadNetwork(), evidence))
  }

  private async scope(context: NetworkContext, claimant: Claimant, milestone: GrantMilestoneId, now: number): Promise<ClaimScope> {
    const storage = this.room.storage
    const wallet = paymentAddress(claimant.player.walletAddress)
    return {
      context,
      ledger: await readLedger(storage, this.base, now),
      record: await storage.get<GrantRecord>(grantRecordKey(this.base, grantId(milestone, claimant.player.id))),
      wallet: await readCharge(storage, walletChargeKey(this.base, wallet)),
      device: claimant.deviceHash ? await readCharge(storage, deviceChargeKey(this.base, claimant.deviceHash)) : null,
    }
  }

  /** Critical section: re-checks everything against stored state and chain facts, then signs and records the reservation in one transaction. */
  private async reserve(claimant: Claimant, config: TreasuryConfig, milestone: GrantMilestoneId, facts: ClaimChainFacts): Promise<{ record: GrantRecord; fresh: boolean } | { refusal: GrantRefusal }> {
    const now = Date.now()
    const { player, deviceHash } = claimant
    const scope = await this.scope((await this.room.loadNetwork()).networkContext, claimant, milestone, now)
    if (scope.record && holdsReservation(scope.record)) return { record: scope.record, fresh: false }
    const refusal = await this.refusal(scope, config, claimant, milestone, facts, now)
    if (refusal || !deviceHash || !scope.device || !config.treasuryAddress) {
      const reason = refusal ?? 'grants_disabled'
      await this.noteRefusal(scope.ledger, reason, milestone, claimant, now)
      await this.room.storage.put(this.base, scope.ledger)
      return { refusal: reason }
    }

    const luna = config.amounts[milestone]
    // Last line before a signature: no configuration path reaches here with more than the caps allow.
    if (luna <= 0 || luna + config.feeLuna > config.caps.transactionLuna || luna + config.feeLuna > TRANSACTION_CEILING_LUNA) throw new ApiError('grants_disabled', 409)
    const recipient = paymentAddress(player.walletAddress)
    const signed = await signGrant(this.room.env, { recipient, luna, feeLuna: config.feeLuna, height: facts.height, network: config.network, milestone })
    const previous = scope.record
    const record: GrantRecord = {
      id: grantId(milestone, player.id),
      milestone,
      playerId: player.id,
      handle: player.handle,
      controlled: isOperator(this.room.env.OPS_PLAYERS, player),
      sender: signed.sender,
      recipient,
      deviceHash,
      network: config.network,
      luna,
      feeLuna: config.feeLuna,
      state: 'prepared',
      txHash: signed.hash,
      serializedHex: signed.serializedHex,
      validityStartHeight: facts.height,
      attempt: (previous?.attempt ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
      lastBroadcastAt: null,
      confirmations: null,
      blockNumber: null,
      failure: null,
      released: false,
      batonId: null,
      failedHashes: previous ? [...previous.failedHashes, previous.txHash] : [],
    }
    scope.ledger.treasury = { balanceLuna: facts.treasuryLuna, at: now }
    charge(scope.ledger, scope.wallet, scope.device, record, now)
    await this.room.storage.transaction(async transaction => {
      await transaction.put(grantRecordKey(this.base, record.id), record)
      await transaction.put(walletChargeKey(this.base, recipient), scope.wallet)
      await transaction.put(deviceChargeKey(this.base, deviceHash), scope.device)
      await transaction.put(this.base, scope.ledger)
    })
    await this.room.storage.setAlarm(now + RECONCILE_RETRY_MS)
    return { record, fresh: true }
  }

  private async markBroadcast(sent: GrantRecord): Promise<void> {
    await this.room.exclusively(async () => {
      const key = grantRecordKey(this.base, sent.id)
      const record = await this.room.storage.get<GrantRecord>(key)
      if (!record || record.txHash !== sent.txHash || record.state !== 'prepared') return
      record.state = 'broadcast'
      record.lastBroadcastAt = Date.now()
      record.updatedAt = record.lastBroadcastAt
      await this.room.storage.put(key, record)
    })
  }

  /**
   * The first reason the claim cannot go ahead, or null. Without chain facts the treasury balance and a starter
   * wallet's balance are not judged; the reservation step always has them.
   */
  private async refusal(scope: ClaimScope, config: TreasuryConfig, claimant: Claimant, milestone: GrantMilestoneId, facts: Pick<ClaimChainFacts, 'walletLuna'> & Partial<ClaimChainFacts> | null, now: number): Promise<GrantRefusal | null> {
    const { ledger, wallet, device, record, context } = scope
    const id = grantId(milestone, claimant.player.id)
    const total = config.amounts[milestone] + config.feeLuna
    if (!config.enabled) return 'grants_disabled'
    if (ledger.paused) return 'grants_paused'
    if (record && record.attempt >= MAX_FAILED_ATTEMPTS) return 'too_many_grant_claims'
    if (!claimant.deviceHash || !device) return 'no_device_signal'
    if (wallet.grants[milestone] !== undefined && wallet.grants[milestone] !== id) return 'wallet_already_claimed'
    if (device.grants[milestone] !== undefined && device.grants[milestone] !== id) return 'device_already_claimed'
    if (!(await this.meets(context, claimant, milestone, now))) return 'requirement_not_met'
    if (wallet.chargedLuna + total > config.caps.participantLuna || device.chargedLuna + total > config.caps.participantLuna) return 'participant_cap_reached'
    if (chargedToday(ledger, now) + total > config.caps.dailyLuna) return 'daily_cap_reached'
    if (ledger.globalLuna + total > config.caps.globalLuna) return 'global_cap_reached'
    if (milestone === 'starter' && facts) {
      if (facts.walletLuna === null) return 'wallet_balance_unknown'
      if (facts.walletLuna >= BATON_VALUE_LUNA + config.feeLuna) return 'wallet_already_funded'
    }
    if (facts?.treasuryLuna !== undefined) {
      const open = await readRecords(this.room.storage, this.base, ledger.open)
      const unsettled = open.filter(isOpenGrant).reduce((sum, item) => sum + item.luna + item.feeLuna, 0)
      if (facts.treasuryLuna - unsettled < total) return 'treasury_exhausted'
    }
    return null
  }

  /** Social referrals count only when the invited runner's recorded device signal differs from the claimant's. */
  private async meets(context: NetworkContext, claimant: Claimant, milestone: GrantMilestoneId, now: number): Promise<boolean> {
    if (milestone !== 'social') return meetsRequirement(context, claimant.player.id, milestone, now)
    if (crewMilestone(context, claimant.player.id, now)) return true
    for (const referral of socialReferrals(context, claimant.player.id)) {
      const records = await readRecords(this.room.storage, this.base, GRANT_MILESTONE_IDS.map(id => grantId(id, referral)))
      const devices = new Set(records.map(item => item.deviceHash))
      if (devices.size > 0 && !devices.has(claimant.deviceHash ?? '')) return true
    }
    return false
  }

  private async presentView(context: NetworkContext, config: TreasuryConfig, claimant: Claimant, walletLuna: number | null): Promise<GrantsView> {
    const now = Date.now()
    const milestones: GrantMilestoneView[] = []
    let claimedLuna = 0
    let confirmedLuna = 0
    for (const milestone of GRANT_MILESTONE_IDS) {
      const scope = await this.scope(context, claimant, milestone, now)
      const { record } = scope
      const copy = MILESTONE_COPY[milestone]
      const base = { id: milestone, title: copy.title, requirement: copy.requirement, luna: record?.luna ?? config.amounts[milestone], txHash: record?.txHash ?? null, confirmations: record?.confirmations ?? null, batonCode: null, updatedAt: record?.updatedAt ?? null }
      if (record && holdsReservation(record)) {
        claimedLuna += record.luna
        if (record.state === 'confirmed') confirmedLuna += record.luna
        const batonCode = record.batonId ? (context.state.batons[record.batonId]?.code ?? null) : null
        const state = record.state === 'confirmed' ? 'confirmed' : record.state === 'failed' ? 'failed' : 'pending'
        milestones.push({ ...base, state, blocked: null, phase: record.state === 'prepared' ? 'signed' : record.state === 'broadcast' ? 'confirming' : null, batonCode })
        continue
      }
      const blocked = await this.refusal(scope, config, claimant, milestone, { walletLuna }, now)
      const state = blocked ? 'locked' : record?.state === 'failed' ? 'failed' : 'available'
      milestones.push({ ...base, state, blocked, phase: null })
    }
    const ledger = await readLedger(this.room.storage, this.base, now)
    return {
      network: config.network,
      enabled: config.enabled,
      paused: ledger.paused !== null,
      deviceSignal: claimant.deviceHash !== null,
      claimedLuna,
      confirmedLuna,
      capLuna: config.caps.participantLuna,
      treasuryAddress: config.treasuryAddress,
      milestones,
    }
  }

  private async noteRefusal(ledger: GrantLedger, refusal: GrantRefusal | null, milestone: GrantMilestoneId, claimant: Claimant, now: number): Promise<void> {
    if (!isAbuseRefusal(refusal)) return
    await logAbuse(ledger, { reason: refusal, milestone, wallet: paymentAddress(claimant.player.walletAddress), deviceHash: claimant.deviceHash }, now)
  }

  private async walletBalance(wallet: string): Promise<number | null> {
    const cached = this.cachedBalance(wallet)
    if (cached !== null) return cached
    const luna = await readWalletBalance(this.room.env, wallet)
    if (luna !== null) this.walletBalances.set(wallet, { luna, at: Date.now() })
    return luna
  }

  private cachedBalance(wallet: string): number | null {
    const cached = this.walletBalances.get(wallet)
    return cached && Date.now() - cached.at < WALLET_BALANCE_TTL_MS ? cached.luna : null
  }

  private requireOperator(player: PlayerRecord): void {
    if (!isOperator(this.room.env.OPS_PLAYERS, player)) throw new ApiError('operators_only', 403)
  }
}

function lowBalance(ledger: GrantLedger, config: TreasuryConfig): boolean {
  return ledger.treasury !== null && ledger.treasury.balanceLuna < config.caps.lowBalanceLuna
}

function refusalError(refusal: GrantRefusal): ApiError {
  return new ApiError(refusal, REFUSAL_STATUS[refusal] ?? 409)
}

const GRANT_DATA: Readonly<Record<GrantMilestoneId, string>> = {
  starter: 'NIM Relay grant: Starter Baton',
  first_handoff: 'NIM Relay grant: first handoff',
  atlas_explorer: 'NIM Relay grant: Atlas explorer',
  return_handoff: 'NIM Relay grant: back for more',
  social: 'NIM Relay grant: bring a runner',
}

/** Signs with the treasury key. Any failure surfaces as one generic error that carries nothing from the key or the signer. */
async function signGrant(env: Env, input: { recipient: string; luna: number; feeLuna: number; height: number; network: TreasuryConfig['network']; milestone: GrantMilestoneId }) {
  try {
    return await signBasicTransfer({
      privateKeyHex: treasuryKey(env),
      recipient: input.recipient,
      valueLuna: BigInt(input.luna),
      feeLuna: BigInt(input.feeLuna),
      validityStartHeight: input.height,
      network: input.network,
      data: new TextEncoder().encode(GRANT_DATA[input.milestone]),
    })
  } catch {
    throw new ApiError('treasury_unavailable', 503)
  }
}
