import { describe, expect, it, vi } from 'vitest'
import { createIdenticonCache, identiconSeed } from './identicon'

describe('identicon seed', () => {
  it('regroups a compact server address the way Nimiq’s wallets hash it', () => {
    // #given the relay server's compact, upper-case address
    // #when it becomes the identicon seed
    const seed = identiconSeed('NQ0700000000000000000000000000000000')
    // #then it matches @nimiq/utils normalizeAddress output
    expect(seed).toBe('NQ07 0000 0000 0000 0000 0000 0000 0000 0000')
  })

  it('normalizes case, spacing and dashes to the same seed', () => {
    expect(identiconSeed('nq07-0000 00000000 0000 0000 0000 0000 0000')).toBe('NQ07 0000 0000 0000 0000 0000 0000 0000 0000')
  })

  it('rejects text that isn’t a Nimiq address', () => {
    expect(identiconSeed('NQ07 0000')).toBeNull()
    expect(identiconSeed('0x52908400098527886E0F7030069857D2E4169EE7')).toBeNull()
  })
})

describe('identicon cache', () => {
  it('generates once per seed and notifies subscribers when ready', async () => {
    // #given a cache over a generator
    const generate = vi.fn((seed: string) => Promise.resolve(`data:${seed}`))
    const cache = createIdenticonCache(generate)
    const listener = vi.fn()
    cache.subscribe(listener)
    // #when the same seed is requested twice
    cache.request('NQ07 A')
    cache.request('NQ07 A')
    await vi.waitFor(() => expect(cache.read('NQ07 A')).toBe('data:NQ07 A'))
    // #then it was generated once and the subscriber heard about it
    expect(generate).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed seed on initials instead of retrying', async () => {
    // #given a generator that fails
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const generate = vi.fn(() => Promise.reject(new Error('no parser')))
    const cache = createIdenticonCache(generate)
    // #when requested again after the failure
    cache.request('NQ07 B')
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    cache.request('NQ07 B')
    // #then
    expect(cache.read('NQ07 B')).toBeNull()
    expect(generate).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
