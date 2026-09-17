import { matchRoute, routePattern } from '../shell/router'

/**
 * The route a visit started on, as a pattern: `/invite/9f8e7d` becomes `/invite/:token`. Parameters, queries and
 * hashes never leave the device, so an invitation token or a runner's handle can't reach analytics.
 */
export function entryRouteOf(pathname: string): string {
  const route = matchRoute(pathname)
  return route.name === 'notFound' ? '/not-found' : routePattern(route.name)
}
