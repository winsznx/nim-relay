import type { relayLeg } from '@nim-relay/game-engine'
import { alpineKit } from './alpine'
import { coastKit } from './coast'
import { metroKit } from './metro'
import { oceanKit } from './ocean'
import { solarKit } from './solar'
import type { WorldKit } from './types'

export const WORLD_KITS: Readonly<Record<relayLeg.World, WorldKit>> = {
  coast: coastKit,
  metro: metroKit,
  alpine: alpineKit,
  solar: solarKit,
  ocean: oceanKit,
}

export type { WorldFrame, WorldKit, WorldLayer, WorldStyle } from './types'
