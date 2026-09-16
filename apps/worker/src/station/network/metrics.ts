import type { NetworkMetrics } from '@nim-relay/shared'
import type { NetworkContext } from './types'

const METRIC_DEFINITIONS = [
  'Wallets are linked accounts, not verified unique humans.',
  'Qualified handoffs require independent chain verification and canonical replay.',
  'All TestAlbatross activity is test evidence, excluded from mainnet traction.',
  'Countries are consented network observations, VPN-sensitive; unknown locations are not inferred.',
  'Returning wallets were active on more than one UTC day.',
  'Session seconds are bounded server-observed authenticated foreground heartbeats.',
  'Invite opens count each valid invitation link at most once per UTC day.',
  'Quick matches are created friend matches; rematches are those started from a finished match.',
  'Chronicle views count public Chronicle loads, not unique visitors.',
  'Shares are share actions reported by the app, capped per runner or anonymous device key per UTC day; delivery is not verified.',
]

export function networkMetrics(context: NetworkContext): NetworkMetrics {
  const { state, product, traffic } = context
  const qualified = state.handoffs.filter(handoff => handoff.qualified)
  const transacting = new Set(qualified.flatMap(handoff => [handoff.from.wallet, handoff.to.wallet]))
  const testnet = context.env.NIMIQ_NETWORK === 'TestAlbatross'
  const members = Object.values(state.members)
  const linkedWallets = new Set(Object.keys(state.members).flatMap(playerId => {
    const wallet = product.players[playerId]?.wallet
    return wallet ? [wallet] : []
  }))
  const sessionSeconds = members.reduce((total, member) => total + member.foreground, 0)
  return {
    linkedWallets: linkedWallets.size,
    transactingWallets: transacting.size,
    qualifiedHandoffs: qualified.length,
    mainnetHandoffs: testnet ? 0 : qualified.length,
    testnetHandoffs: testnet ? qualified.length : 0,
    invites: Object.keys(state.invites).length,
    inviteConversions: Object.values(state.invites).filter(invite => invite.claimedBy).length,
    inviteOpens: traffic.inviteOpens,
    returningWallets: members.filter(member => member.days.length > 1).length,
    quickMatches: Object.values(state.batons).filter(baton => baton.mode === 'quick').length,
    rematches: state.rematches,
    quickRematches: state.rematches,
    crewActiveDays: Object.values(state.crewDays).reduce((total, days) => total + Object.keys(days).length, 0),
    dailyAttempts: Object.values(state.daily).reduce((total, entries) => total + Object.keys(entries).length, 0),
    chronicleViews: traffic.chronicleViews,
    shares: traffic.shares,
    sessionSeconds,
    foregroundSeconds: sessionSeconds,
    controlledEvidence: { handoffs: testnet ? qualified.length : 0, wallets: testnet ? transacting.size : 0 },
    definitions: METRIC_DEFINITIONS,
  }
}
