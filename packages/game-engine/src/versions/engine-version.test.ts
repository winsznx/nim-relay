import { describe, expect, it } from 'vitest'
import { ENGINE_VERSION, isSupportedEngineVersion } from './engine-version'

describe('engine version binding', () => {
  it('accepts the current engine version', () => {
    expect(isSupportedEngineVersion(ENGINE_VERSION)).toBe(true)
  })

  it('rejects an unknown/future engine version', () => {
    expect(isSupportedEngineVersion('99.0.0')).toBe(false)
  })
})
