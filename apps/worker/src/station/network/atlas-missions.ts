import { atlasRoute, type AtlasMission, type AtlasMissionId } from '@nim-relay/shared'
import type { AtlasPlayerLedger } from './types'

/**
 * Atlas missions: the only place they are defined. Progress is read from a runner's Atlas ledger, which only qualified
 * legs write, so a mission can never complete on anything but verified play. Rewards are profile marks, never NIM.
 */

interface MissionDefinition {
  id: AtlasMissionId
  title: string
  description: string
  target: number
  reward: string
  progress(player: AtlasPlayerLedger): number
}

const worldsCarried = (player: AtlasPlayerLedger): number => new Set(player.routes.map(id => atlasRoute(id)?.world).filter(world => world !== undefined)).size

export const ATLAS_MISSIONS: readonly MissionDefinition[] = [
  { id: 'explorer', title: 'EXPLORER', description: 'Complete 3 distinct routes', target: 3, reward: 'Explorer trail mark', progress: player => player.routes.length },
  { id: 'station-hopper', title: 'STATION HOPPER', description: 'Visit 5 stations', target: 5, reward: 'Station stamp on your baton history', progress: player => player.stations.length },
  { id: 'world-carrier', title: 'WORLD CARRIER', description: 'Carry a baton across 3 worlds', target: 3, reward: 'World carrier trail', progress: worldsCarried },
  { id: 'lamplighter', title: 'LAMPLIGHTER', description: 'Light a dark route with the first qualified leg on it', target: 1, reward: 'Lamplighter artifact', progress: player => player.routesLit },
  { id: 'legs-25', title: '25 RELAY LEGS', description: 'Race 25 qualified relay legs', target: 25, reward: 'Bronze baton history mark', progress: player => player.legs },
  { id: 'legs-50', title: '50 RELAY LEGS', description: 'Race 50 qualified relay legs', target: 50, reward: 'Silver baton history mark', progress: player => player.legs },
  { id: 'legs-100', title: '100 RELAY LEGS', description: 'Race 100 qualified relay legs', target: 100, reward: 'Gold baton history mark', progress: player => player.legs },
]

/** Stamps missions the ledger now satisfies. Idempotent: a completed mission keeps its first completion time. */
export function settleAtlasMissions(player: AtlasPlayerLedger, at: number): void {
  for (const mission of ATLAS_MISSIONS) {
    if (player.missions[mission.id] === undefined && mission.progress(player) >= mission.target) player.missions[mission.id] = at
  }
}

export function atlasMissions(player: AtlasPlayerLedger | undefined): AtlasMission[] {
  return ATLAS_MISSIONS.map(mission => ({
    id: mission.id,
    title: mission.title,
    description: mission.description,
    target: mission.target,
    progress: player ? Math.min(mission.target, mission.progress(player)) : 0,
    completedAt: player?.missions[mission.id] ?? null,
    reward: mission.reward,
  }))
}
