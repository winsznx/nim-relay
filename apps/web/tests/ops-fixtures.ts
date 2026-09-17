import type { OpsDay, OpsReport, OpsTour } from '@nim-relay/shared'
import { HOUR } from './relay-fixtures'

/**
 * A test-only operator report shaped like GET /api/station/network/ops on testnet. Counts agree with each other:
 * the funnel narrows stage by stage, runs split into verified, rejected and refused, and the run and share counters
 * start twelve days ago, so the days before read null exactly as the Worker reports them.
 */

const DAY = 24 * HOUR
const WINDOW_DAYS = 30
const COUNTING_DAYS = 12

function utcDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

/** Deterministic, uneven daily activity with a quiet stretch at the start of the window. */
function wave(index: number, scale: number): number {
  if (index < 4) return 0
  return Math.max(0, Math.round(scale * (0.55 + 0.45 * Math.sin(index * 0.9) + (index % 7 === 3 ? 0.6 : 0))))
}

function days(now: number): OpsDay[] {
  const today = Math.floor(now / DAY) * DAY
  return Array.from({ length: WINDOW_DAYS }, (_, index) => {
    const counting = index >= WINDOW_DAYS - COUNTING_DAYS
    const verified = wave(index, 18)
    const rejected = index % 5 === 2 ? 2 : index % 4 === 1 ? 1 : 0
    const refused = index % 6 === 0 ? 1 : 0
    return {
      date: utcDate(today - (WINDOW_DAYS - 1 - index) * DAY),
      newWallets: wave(index + 2, 4),
      activeWallets: 6 + wave(index, 9),
      qualifiedHandoffs: wave(index + 1, 7),
      dailyAttempts: wave(index + 3, 5),
      runsSubmitted: counting ? verified + rejected + refused : null,
      runsVerified: counting ? verified : null,
      runsRejected: counting ? rejected : null,
      runsRefused: counting ? refused : null,
      shares: counting ? wave(index + 4, 3) : null,
    }
  })
}

/** Step views narrow step by step; the skips at each step add up to the tour's mid-way skips. */
const CORE_STEPS: [string, number, number, number][] = [
  ['relay-world', 64, 62, 2],
  ['featured-relay', 62, 61, 1],
  ['open-journey', 61, 58, 3],
  ['nav-inbox', 58, 57, 1],
  ['inbox-turns', 57, 55, 2],
  ['nav-play', 55, 53, 2],
  ['ghost', 53, 50, 3],
  ['social-modes', 50, 48, 2],
  ['daily', 48, 45, 2],
  ['profile-history', 45, 41, 1],
]

function tours(): OpsTour[] {
  return [
    {
      tourId: 'core',
      version: 'v1',
      offered: 120,
      started: 64,
      completed: 41,
      skipped: 19,
      declined: 30,
      replayed: 6,
      steps: CORE_STEPS.map(([stepId, viewed, completed, skippedHere], index) => ({ stepId, stepNumber: index + 1, viewed, completed, skippedHere, missing: stepId === 'daily' ? 2 : 0 })),
      entries: [
        { section: '/', started: 51 },
        { section: '/invite', started: 9 },
        { section: '/relay', started: 4 },
      ],
    },
    {
      tourId: 'gameplay',
      version: 'v1',
      offered: 0,
      started: 38,
      completed: 30,
      skipped: 8,
      declined: 0,
      replayed: 0,
      steps: ['lane', 'jump', 'slide', 'ghostline', 'edge', 'flow'].map((stepId, index) => ({ stepId, stepNumber: index + 1, viewed: 38 - index * 2, completed: 37 - index * 2, skippedHere: index === 2 ? 3 : 1, missing: 0 })),
      entries: [{ section: '/leg', started: 38 }],
    },
  ]
}

export function opsReport(now = Date.now(), overrides: Partial<OpsReport> = {}): OpsReport {
  const countingSince = Math.floor(now / DAY) * DAY - (COUNTING_DAYS - 1) * DAY + 9 * HOUR
  return {
    network: 'TestAlbatross',
    generatedAt: now,
    windowDays: WINDOW_DAYS,
    countingSince: { runs: countingSince, shares: countingSince },
    alerts: [
      { id: 'verification_rejections', severity: 'critical', title: 'Verification rejections above 20%', condition: '4 rejections in the last 24 h against 9 transaction hashes submitted (44%). Alert above 20%.' },
      { id: 'rpc_unavailable', severity: 'critical', title: 'Handoff checks returned RPC_UNAVAILABLE', condition: 'The latest RPC_UNAVAILABLE was 7 min ago, at 21:52 UTC. Alert for 1 h after any.' },
      { id: 'stuck_handoffs', severity: 'warning', title: 'Handoffs open over 30 min', condition: '2 handoffs still open more than 30 min after reaching Nimiq Pay: 1 attempting, 1 submitted. The oldest reached Nimiq Pay 1 h 12 min ago.' },
      { id: 'stranded_batons', severity: 'warning', title: 'Stranded batons', condition: '1 baton stranded: the holder let the 24 h hold pass with no transfer underway.' },
    ],
    totals: {
      linkedWallets: 148,
      transactingWallets: 61,
      qualifiedHandoffs: 212,
      batons: { active: 23, stranded: 1, completed: 40 },
      crews: 9,
      rivals: 4,
      invites: { created: 57, opened: 44, converted: 31 },
      shares: { total: 96, bySurface: { result: 28, handoff: 19, chronicle: 14, daily: 11, crew: 6 }, unattributed: 18 },
      chronicleViews: 380,
      returningWallets: 72,
      foregroundSeconds: 196_400,
      evidence: { mainnetHandoffs: 0, testnetHandoffs: 212, controlledHandoffs: 212, controlledWallets: 61 },
    },
    days: days(now),
    funnel: {
      prepared: 164,
      attempted: 151,
      submitted: 139,
      verified: 128,
      cancelled: 6,
      expired: 9,
      open: 21,
      rejections: {
        SENDER_MISMATCH: 0,
        RECIPIENT_MISMATCH: 3,
        VALUE_MISMATCH: 1,
        DATA_MALFORMED: 0,
        DATA_RELAY_MISMATCH: 0,
        DATA_LEG_MISMATCH: 0,
        DATA_COMMITMENT_MISMATCH: 2,
        NETWORK_MISMATCH: 0,
        EXECUTION_FAILED: 0,
        DUPLICATE_TRANSACTION: 1,
        CUSTODY_CHANGED: 4,
        INTENT_EXPIRED: 0,
      },
      medianAttemptToVerifiedMs: 94_000,
    },
    flaggedRuns: [
      { handle: 'mateo', reason: 'INVALID_TRACE', mode: 'global', practice: false, at: now - 2 * HOUR, attempts: 3 },
      { handle: 'sam', reason: 'MAC_MISMATCH', mode: 'daily', practice: false, at: now - 9 * HOUR, attempts: 1 },
      { handle: 'lena', reason: 'INVALID_TRACE', mode: 'quick', practice: true, at: now - 30 * HOUR, attempts: 1 },
    ],
    nimFlow: [{ network: 'TestAlbatross', handoffs: 212, luna: 21_200_000, nim: 212 }],
    onboarding: { countingSince, tours: tours() },
    ...overrides,
  }
}
