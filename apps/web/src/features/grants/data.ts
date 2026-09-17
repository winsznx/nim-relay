import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { GrantMilestoneId, GrantsView } from '@nim-relay/shared'
import { create } from 'zustand'
import { linkDeviceSignal } from '../../lib/auth-api'
import { deviceIdentifier } from '../../lib/nimiq'
import { loadBaton } from '../relays/api'
import { relayKeys } from '../relays/data'
import { openOverlay } from '../shell/router'
import { useRequireRunner } from '../shell/session'
import { playAtlasFlight } from '../world/globe-bridge'
import { claimGrant, loadGrants } from './api'
import { useClaimFlow, type ClaimDeps } from './claim-flow'

export const grantKeys = { view: ['grants'] as const, ops: ['grants-ops'] as const }
export const GRANT_OVERLAY = 'relay-grant'
const PENDING_POLL_MS = 5_000
const DEVICE_REASON = 'Relay Grants: one Starter Baton per device. NIM Relay keeps only a private hash of this identifier.'

export function useGrants(enabled: boolean) {
  return useQuery({
    queryKey: grantKeys.view,
    queryFn: loadGrants,
    enabled,
    staleTime: 30_000,
    retry: false,
    refetchInterval: query => (query.state.data?.milestones.some(item => item.state === 'pending') ? PENDING_POLL_MS : false),
  })
}

interface GrantSheetState {
  grantId: GrantMilestoneId
  select(grantId: GrantMilestoneId): void
}

/** Which grant the claim sheet is about. */
export const useGrantSheet = create<GrantSheetState>(set => ({
  grantId: 'starter',
  select: grantId => set({ grantId }),
}))

/** Opens the claim sheet for a grant, asking the runner to sign in first when needed. */
export function useOpenGrant(): (grantId: GrantMilestoneId) => void {
  const requireRunner = useRequireRunner()
  const select = useGrantSheet(state => state.select)
  return grantId =>
    requireRunner('Sign in to claim your Starter Baton.', () => {
      if (!useClaimFlow.getState().running) useClaimFlow.getState().reset()
      select(grantId)
      openOverlay(GRANT_OVERLAY)
    })
}

export function claimDeps(client: QueryClient): ClaimDeps {
  const publish = (grants: GrantsView) => client.setQueryData(grantKeys.view, grants)
  return {
    loadGrants: () => client.fetchQuery({ queryKey: grantKeys.view, queryFn: loadGrants, staleTime: 0 }),
    claimGrant,
    requestDevice: () => deviceIdentifier(DEVICE_REASON),
    linkDevice: linkDeviceSignal,
    loadBaton: async code => {
      const detail = await loadBaton(code)
      void client.invalidateQueries({ queryKey: relayKeys.network })
      return { name: detail.baton.displayName, destination: detail.baton.route.destination }
    },
    fly: to => playAtlasFlight({ from: 'genesis', to, kind: 'grant' }),
    onGrants: publish,
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
  }
}

export function useStartClaim(): (grantId: GrantMilestoneId) => void {
  const client = useQueryClient()
  const start = useClaimFlow(state => state.start)
  return grantId => start(grantId, claimDeps(client))
}
