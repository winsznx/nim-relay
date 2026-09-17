import { describe, expect, it } from 'vitest'
import type { Env } from '../../../env'
import { treasuryConfig, treasuryKey } from './config'

const KEY = '5a'.repeat(32)
const base = { NIMIQ_NETWORK: 'TestAlbatross', NIMIQ_RPC_URL: 'https://rpc.invalid/', TREASURY_ENABLED: 'true', TREASURY_PRIVATE_KEY: KEY }
const envWith = (overrides: Record<string, string>) => ({ ...base, ...overrides }) as Env

describe('treasury configuration', () => {
  it('uses the documented defaults: 1 NIM per milestone, 1.5 NIM per transfer, 5 NIM per participant', async () => {
    // #given only the switch and the key
    // #when the configuration is read
    const config = await treasuryConfig(envWith({}))
    // #then grants are on with the default caps
    expect(config).toMatchObject({ enabled: true, problem: null, feeLuna: 0, caps: { transactionLuna: 150_000, participantLuna: 500_000, dailyLuna: 2_500_000, globalLuna: 50_000_000, lowBalanceLuna: 1_000_000 } })
    expect(Object.values(config.amounts)).toEqual([100_000, 100_000, 100_000, 100_000, 100_000])
    expect((await treasuryConfig(envWith({ NIMIQ_NETWORK: 'MainAlbatross' }))).caps.globalLuna).toBe(10_000_000)
  })

  it('stays off unless explicitly enabled with a usable key', async () => {
    expect((await treasuryConfig(envWith({ TREASURY_ENABLED: 'false' }))).enabled).toBe(false)
    const badKey = await treasuryConfig(envWith({ TREASURY_PRIVATE_KEY: 'not-a-key' }))
    expect(badKey).toMatchObject({ enabled: false, problem: 'TREASURY_PRIVATE_KEY is missing or not a 32-byte hex key', treasuryAddress: null })
  })

  it('lets variables lower caps but turns grants off when one would raise a ceiling or break the sums', async () => {
    expect((await treasuryConfig(envWith({ TREASURY_DAILY_CAP_NIM: '10', GRANT_AMOUNTS_NIM: 'starter:0.5' }))).caps.dailyLuna).toBe(1_000_000)
    for (const overrides of [{ TREASURY_PARTICIPANT_CAP_NIM: '6' }, { TREASURY_TX_CAP_NIM: '3' }, { GRANT_AMOUNTS_NIM: 'starter:2' }, { TREASURY_PARTICIPANT_CAP_NIM: '4' }, { GRANT_AMOUNTS_NIM: 'jackpot:1' }, { TREASURY_DAILY_CAP_NIM: 'lots' }, { GRANT_FEE_LUNA: '5000' }, { TREASURY_DAILY_CAP_NIM: '600' }]) {
      const config = await treasuryConfig(envWith(overrides))
      expect(config.enabled, JSON.stringify(overrides)).toBe(false)
      expect(config.problem).not.toBeNull()
    }
  })

  it('adds a non-zero fee to the starter amount so the first pass is covered', async () => {
    const config = await treasuryConfig(envWith({ GRANT_FEE_LUNA: '138', GRANT_AMOUNTS_NIM: 'first_handoff:0.5,atlas_explorer:0.5' }))
    expect(config).toMatchObject({ enabled: true, feeLuna: 138, amounts: { starter: 100_138 } })
  })

  it('never puts the key into what it reports or throws', async () => {
    const config = await treasuryConfig(envWith({}))
    expect(JSON.stringify(config)).not.toContain(KEY)
    const error = (() => {
      try {
        return treasuryKey(envWith({ TREASURY_PRIVATE_KEY: `${KEY.slice(0, 63)}z` }))
      } catch (caught) {
        return caught
      }
    })()
    expect(String(error)).toBe('Error: Treasury key unavailable')
  })
})
