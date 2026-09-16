import { useQuery } from '@tanstack/react-query'
import * as api from '../relays/api'

export const OPS_REPORT_KEY = ['ops-report'] as const
export const OPS_REFRESH_MS = 30_000

/**
 * The operator report for a signed-in runner. It refreshes every 30 seconds while the page is visible: interval
 * refetches pause in background tabs and a returning tab refetches on focus.
 */
export function useOpsReport(signedIn: boolean) {
  return useQuery({
    queryKey: OPS_REPORT_KEY,
    queryFn: api.loadOpsReport,
    enabled: signedIn,
    refetchInterval: OPS_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: (failures, error) => !(error instanceof api.NetworkApiError && error.status < 500) && failures < 1,
  })
}

/** A missing session or a runner OPS_PLAYERS does not list. */
export function isOperatorRefusal(error: unknown): boolean {
  return error instanceof api.NetworkApiError && (error.status === 401 || error.status === 403)
}
