/** Version 1 is immutable. Future engines must retain recorded-version replay handlers. */
export const ENGINE_VERSION = '1.0.0' as const
export const SUPPORTED_ENGINE_VERSIONS: readonly string[] = Object.freeze([ENGINE_VERSION])
export function isSupportedEngineVersion(version: string): boolean {
  return SUPPORTED_ENGINE_VERSIONS.includes(version)
}
