import { useMemo } from 'react'
import type { RunnerProfile } from '@nim-relay/shared'
import { useNetwork } from '../relays/data'

/** Hooks shared by the social screens. */

export interface ProfileLookups {
  /** Baton codes by baton id, from the profile's own history and the live network. */
  batonCodes: ReadonlyMap<string, string>
  /** Nimiq addresses by handle, for identicons of runners the profile only names. */
  walletsByHandle: ReadonlyMap<string, string>
}

export function useProfileLookups(historicBatons: RunnerProfile['historicBatons'] | undefined): ProfileLookups {
  const { snapshot } = useNetwork()
  return useMemo(() => {
    const batonCodes = new Map<string, string>()
    for (const baton of snapshot?.batons ?? []) batonCodes.set(baton.id, baton.code)
    for (const baton of historicBatons ?? []) batonCodes.set(baton.id, baton.code)
    const walletsByHandle = new Map((snapshot?.runners ?? []).map(runner => [runner.handle, runner.wallet]))
    return { batonCodes, walletsByHandle }
  }, [snapshot, historicBatons])
}
