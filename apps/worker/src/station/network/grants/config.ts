import { nimiqAddressFromPrivateKey } from '@nim-relay/relay-protocol'
import { GRANT_MILESTONE_IDS, type GrantMilestoneId, type RelayNetwork } from '@nim-relay/shared'
import type { Env } from '../../../env'
import { BATON_VALUE_LUNA } from '../constants'

const LUNA_PER_NIM = 100_000

/**
 * Hard ceilings no Worker variable can raise. A variable may only lower a cap; a value above its ceiling, or amounts
 * that no longer fit the caps, turn grants off instead of being clamped (fail closed).
 */
export const PARTICIPANT_CEILING_LUNA = 5 * LUNA_PER_NIM
export const TRANSACTION_CEILING_LUNA = 2 * LUNA_PER_NIM
const FEE_CEILING_LUNA = 1_000

export const DEFAULT_CAPS = {
  transactionLuna: 150_000,
  participantLuna: PARTICIPANT_CEILING_LUNA,
  dailyLuna: 25 * LUNA_PER_NIM,
  globalLuna: { MainAlbatross: 100 * LUNA_PER_NIM, TestAlbatross: 500 * LUNA_PER_NIM } satisfies Record<RelayNetwork, number>,
  lowBalanceLuna: 10 * LUNA_PER_NIM,
} as const

export const DEFAULT_AMOUNTS: Readonly<Record<GrantMilestoneId, number>> = {
  starter: BATON_VALUE_LUNA,
  first_handoff: LUNA_PER_NIM,
  atlas_explorer: LUNA_PER_NIM,
  return_handoff: LUNA_PER_NIM,
  social: LUNA_PER_NIM,
}

export interface TreasuryCaps {
  transactionLuna: number
  participantLuna: number
  dailyLuna: number
  globalLuna: number
  lowBalanceLuna: number
}

export interface TreasuryConfig {
  network: RelayNetwork
  /** TREASURY_ENABLED is "true" and everything below parsed. Runtime pause is separate, in the ledger. */
  enabled: boolean
  /** Why grants are off although TREASURY_ENABLED asks for them. Never contains the key. */
  problem: string | null
  treasuryAddress: string | null
  caps: TreasuryCaps
  amounts: Record<GrantMilestoneId, number>
  feeLuna: number
}

/** The treasury key for signing, read only where a transfer is signed. Throws a generic error, never the value. */
export function treasuryKey(env: Env): string {
  const key = env.TREASURY_PRIVATE_KEY?.trim() ?? ''
  if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('Treasury key unavailable')
  return key
}

export async function treasuryConfig(env: Env): Promise<TreasuryConfig> {
  const network = env.NIMIQ_NETWORK
  const fallback: TreasuryConfig = {
    network,
    enabled: false,
    problem: null,
    treasuryAddress: null,
    caps: { ...DEFAULT_CAPS, globalLuna: DEFAULT_CAPS.globalLuna[network] },
    amounts: { ...DEFAULT_AMOUNTS },
    feeLuna: 0,
  }
  const off = (problem: string): TreasuryConfig => ({ ...fallback, problem })
  try {
    const feeLuna = parseLuna(env.GRANT_FEE_LUNA, 0, 'GRANT_FEE_LUNA')
    if (feeLuna > FEE_CEILING_LUNA) return off('GRANT_FEE_LUNA is above its ceiling')
    const caps: TreasuryCaps = {
      transactionLuna: parseNim(env.TREASURY_TX_CAP_NIM, DEFAULT_CAPS.transactionLuna, 'TREASURY_TX_CAP_NIM'),
      participantLuna: parseNim(env.TREASURY_PARTICIPANT_CAP_NIM, DEFAULT_CAPS.participantLuna, 'TREASURY_PARTICIPANT_CAP_NIM'),
      dailyLuna: parseNim(env.TREASURY_DAILY_CAP_NIM, DEFAULT_CAPS.dailyLuna, 'TREASURY_DAILY_CAP_NIM'),
      globalLuna: parseNim(env.TREASURY_GLOBAL_CAP_NIM, DEFAULT_CAPS.globalLuna[network], 'TREASURY_GLOBAL_CAP_NIM'),
      lowBalanceLuna: parseNim(env.TREASURY_LOW_BALANCE_NIM, DEFAULT_CAPS.lowBalanceLuna, 'TREASURY_LOW_BALANCE_NIM'),
    }
    // Starter covers the baton value plus the fee of the pass it pays for.
    const amounts = { ...DEFAULT_AMOUNTS, starter: DEFAULT_AMOUNTS.starter + feeLuna, ...parseAmounts(env.GRANT_AMOUNTS_NIM) }
    const configured: TreasuryConfig = { ...fallback, caps, amounts, feeLuna }
    const invalid = capProblem(caps, amounts, feeLuna)
    if (invalid) return { ...configured, problem: invalid }
    if (env.TREASURY_ENABLED !== 'true') return configured
    let treasuryAddress: string
    try {
      treasuryAddress = await nimiqAddressFromPrivateKey(treasuryKey(env))
    } catch {
      return { ...configured, problem: 'TREASURY_PRIVATE_KEY is missing or not a 32-byte hex key' }
    }
    return { ...configured, enabled: true, treasuryAddress }
  } catch (error) {
    return off(error instanceof ConfigError ? error.message : 'Treasury configuration unreadable')
  }
}

function capProblem(caps: TreasuryCaps, amounts: Record<GrantMilestoneId, number>, feeLuna: number): string | null {
  if (caps.participantLuna > PARTICIPANT_CEILING_LUNA) return 'TREASURY_PARTICIPANT_CAP_NIM is above 5 NIM'
  if (caps.transactionLuna > TRANSACTION_CEILING_LUNA || caps.transactionLuna > caps.participantLuna) return 'TREASURY_TX_CAP_NIM is above its ceiling'
  if (caps.dailyLuna > caps.globalLuna) return 'TREASURY_DAILY_CAP_NIM is above the global cap'
  let total = 0
  for (const id of GRANT_MILESTONE_IDS) {
    const amount = amounts[id]
    if (amount <= 0 || amount + feeLuna > caps.transactionLuna) return `Grant amount for ${id} is above the per-transaction cap`
    total += amount + feeLuna
  }
  if (total > caps.participantLuna) return 'Grant amounts add up to more than the participant cap'
  return null
}

class ConfigError extends Error {}

function parseNim(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback
  return nimToLuna(value.trim(), name)
}

function nimToLuna(text: string, name: string): number {
  const match = /^(\d{1,7})(?:\.(\d{1,5}))?$/.exec(text)
  if (!match) throw new ConfigError(`${name} is not a NIM amount`)
  return Number(match[1]) * LUNA_PER_NIM + Number((match[2] ?? '').padEnd(5, '0'))
}

function parseLuna(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback
  if (!/^\d{1,9}$/.test(value.trim())) throw new ConfigError(`${name} is not a whole Luna amount`)
  return Number(value.trim())
}

function parseAmounts(value: string | undefined): Partial<Record<GrantMilestoneId, number>> {
  if (value === undefined || value.trim() === '') return {}
  const amounts: Partial<Record<GrantMilestoneId, number>> = {}
  for (const entry of value.split(',')) {
    const [id, amount] = entry.split(':').map(part => part.trim())
    const milestone = GRANT_MILESTONE_IDS.find(candidate => candidate === id)
    if (!milestone || amount === undefined) throw new ConfigError('GRANT_AMOUNTS_NIM is not a list of milestone:amount')
    amounts[milestone] = nimToLuna(amount, 'GRANT_AMOUNTS_NIM')
  }
  return amounts
}
