import type { BatonAtlas } from '@nim-relay/shared'
import type { BatonRecord } from '../types'

/** A starter baton's Atlas journey opens with the treasury grant at Genesis Station, before its first leg. It is never a leg. */
export function withStarterGrant(baton: Pick<BatonRecord, 'starterGrant'>, atlas: BatonAtlas): BatonAtlas {
  if (!baton.starterGrant) return atlas
  return { ...atlas, journey: [baton.starterGrant, ...atlas.journey.filter(entry => entry.kind !== 'treasury_starter_grant')] }
}
