/**
 * PRD section 7.3 - every run is bound to an engine_version. A leaderboard
 * entry never changes behavior after a new engine release; old replays
 * remain replayable by their recorded version.
 *
 * Real challenge simulation (Stabilize/Slipstream/Pulse Sync/Sling/Redline)
 * lands in Phase 3. This module exists now so the version-binding contract
 * (and its test) is real from Phase 1 onward, not bolted on later.
 */
export const ENGINE_VERSION = '0.1.0' as const

export const SUPPORTED_ENGINE_VERSIONS: readonly string[] = [ENGINE_VERSION]

export function isSupportedEngineVersion(version: string): boolean {
  return SUPPORTED_ENGINE_VERSIONS.includes(version)
}
