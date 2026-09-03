import { describe, expect, it } from 'vitest'
import { hashDeviceId } from './device-hash'

const fakeEnv = { DEVICE_HASH_SECRET: 'pepper-do-not-use-in-prod' } as never

describe('hashDeviceId', () => {
  it('is deterministic for the same input', async () => {
    const a = await hashDeviceId(fakeEnv, 'raw-device-id-abc')
    const b = await hashDeviceId(fakeEnv, 'raw-device-id-abc')
    expect(a).toBe(b)
  })

  it('differs for different device ids', async () => {
    const a = await hashDeviceId(fakeEnv, 'device-a')
    const b = await hashDeviceId(fakeEnv, 'device-b')
    expect(a).not.toBe(b)
  })

  it('never leaks the raw device id in the output', async () => {
    const raw = 'super-secret-raw-device-identifier'
    const hashed = await hashDeviceId(fakeEnv, raw)
    expect(hashed).not.toContain(raw)
    expect(hashed).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs across secrets (pepper actually participates)', async () => {
    const a = await hashDeviceId(fakeEnv, 'device-a')
    const otherEnv = { DEVICE_HASH_SECRET: 'a-different-pepper' } as never
    const b = await hashDeviceId(otherEnv, 'device-a')
    expect(a).not.toBe(b)
  })
})
