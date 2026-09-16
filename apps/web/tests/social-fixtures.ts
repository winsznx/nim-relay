import type { BatonDetail, BatonHandoff, CanonicalGhost, HandoffRace, NetworkBaton, NetworkCrew, NetworkRival, NetworkRunner, RunnerProfile } from '@nim-relay/shared'
import { HOUR, RUNNERS, baton, hash, populatedNetwork, profileOf, signedInAs, type MockNetwork } from './relay-fixtures'

/**
 * Test-only fixtures for the social surfaces, layered on the populated network:
 * a crew whose streak is at risk, a rivalry still racing and one already won,
 * a Daily with a full board, a reservation waiting on Mateo and a baton that
 * passed its tenth handoff. Every count agrees with the handoffs behind it.
 */

const DAY = 24 * HOUR

interface Leg {
  at: number
  race?: Partial<HandoffRace> | null
}

function handoffsAlong(record: NetworkBaton, path: readonly NetworkRunner[], legs: readonly Leg[], seed: number): BatonHandoff[] {
  return path.slice(1).map((to, index) => {
    const leg = legs[index] ?? { at: record.updatedAt }
    const runId = `run-${record.code}-${index + 1}`
    return {
      id: `${record.id}-h${index + 1}`,
      batonId: record.id,
      leg: index + 1,
      from: path[index] ?? to,
      to,
      value: 100_000,
      txHash: hash(seed + index),
      network: 'TestAlbatross',
      at: leg.at,
      runId,
      resultHash: hash(seed + 40 + index),
      qualified: true,
      confirmations: 3,
      blockNumber: 11_640_000 + seed * 97 + index * 3_217,
      sector: 0,
      race: leg.race === null ? null : { engineVersion: '5', world: record.world, timeMs: 60_000, score: 18_000, completed: true, ghostRunId: null, ghostTimeMs: null, beatGhost: null, ...leg.race },
      rescue: false,
    }
  })
}

function detailOf(record: NetworkBaton, handoffs: BatonHandoff[]): BatonDetail {
  return { baton: record, handoffs, ghost: null, pendingHandoff: null, notableRuns: handoffs.map(item => ({ runId: item.runId, name: item.from.name, score: item.race?.score ?? 0, resultHash: item.resultHash })), echoes: [] }
}

/** A verified v5 replay whose metrics give 14 of 16 perfect gates and 87% flow control. */
function replayOf(handoff: BatonHandoff): CanonicalGhost {
  const ticks = Math.round((handoff.race?.timeMs ?? 60_000) / (1000 / 60))
  return {
    runId: handoff.runId,
    name: handoff.from.name,
    runner: { name: handoff.from.name, country: handoff.from.country },
    timeMs: handoff.race?.timeMs ?? 60_000,
    config: { engineVersion: '5', challenge: 'relay-leg', challengeVersion: '5', seed: 'fixture', world: handoff.race?.world ?? 'coast', tier: 0, openingFlow: 0 },
    inputTrace: [],
    result: {
      score: handoff.race?.score ?? 18_000,
      resultHash: handoff.resultHash,
      completed: true,
      ticks,
      timeMs: handoff.race?.timeMs ?? 60_000,
      metrics: { perfectGates: 14, totalGates: 16, pulseHits: 9, nearMisses: 4, hits: 1, falls: 0, jumps: 6, cleanLandings: 5, slides: 3, railTicks: 120, boostPadTicks: 40, riskRoutes: 2, flowSum: Math.round(0.87 * ticks * 65_536), flowPeak: 65_536 },
    },
    verified: true,
  }
}

export function socialNetwork(now = Date.now()): MockNetwork & { account: ReturnType<typeof signedInAs> } {
  const base = populatedNetwork(now)
  const { ada, lena, arjun, mei, mateo, sam, wanjiru, thandi } = RUNNERS
  const midnight = Math.floor(now / DAY) * DAY
  const [global] = base.snapshot.batons
  if (!global) throw new Error('populated network lost its Global Relay')

  // Crew: six handoffs on six consecutive UTC days up to yesterday, so the streak is 6 and at risk today.
  const oldCrewPath = [mateo, thandi, wanjiru, thandi, mateo]
  const oldCrew = baton({ id: 'b-crew-old', code: 'CR3W0LD7QX', serial: 1, mode: 'crew', title: 'Rift Valley Runners relay', path: oldCrewPath, createdAt: midnight - 7 * DAY, updatedAt: midnight - 3 * DAY + 10 * HOUR, status: 'completed', crewId: 'crew-rift' })
  const crewPath = [thandi, mateo, wanjiru]
  const crewBaton = baton({ id: 'b-crew', code: 'C4NB7T90RE', serial: 2, mode: 'crew', title: 'Rift Valley night shift', path: crewPath, createdAt: midnight - 2 * DAY, updatedAt: midnight - DAY + 9 * HOUR, crewId: 'crew-rift' })
  const oldCrewHandoffs = handoffsAlong(oldCrew, oldCrewPath, [6, 5, 4, 3].map(days => ({ at: midnight - days * DAY + 10 * HOUR })), 200)
  const crewHandoffs = handoffsAlong(crewBaton, crewPath, [{ at: midnight - 2 * DAY + 14 * HOUR, race: { timeMs: 60_120, score: 17_900 } }, { at: midnight - DAY + 9 * HOUR, race: { timeMs: 58_410, score: 19_450, ghostRunId: `run-${crewBaton.code}-1`, ghostTimeMs: 60_120, beatGhost: true } }], 300)
  const crew: NetworkCrew = {
    id: 'crew-rift',
    code: 'RIFT42',
    name: 'Rift Valley Runners',
    members: [mateo, wanjiru, thandi],
    batonIds: [oldCrew.id, crewBaton.id],
    streak: 6,
    bestStreak: 9,
    todayHandoffs: 0,
    contributions: { [thandi.id]: 3, [mateo.id]: 2, [wanjiru.id]: 1 },
    deadline: midnight + DAY,
  }
  const otherCrew: NetworkCrew = { id: 'crew-harbour', code: null, name: 'Harbour Lights', members: [ada, lena, arjun, mei], batonIds: [], streak: 11, bestStreak: 14, todayHandoffs: 2, contributions: {}, deadline: midnight + DAY }

  // Rivalries: Mateo captains gold, whose baton waits on Mei to pick a runner; Coast Cup already went to cyan.
  const goldPath = [mateo, ada, lena, sam, wanjiru, thandi, mei]
  const cyanPath = [lena, ada, mei, sam, arjun]
  const gold = baton({ id: 'b-rival-gold', code: 'GOLDN0RTH1', serial: 1, mode: 'rival', title: 'North vs South · Mateo Silva', path: goldPath, createdAt: now - 3 * DAY, updatedAt: now - 4 * HOUR, rivalId: 'rival-ns' })
  const cyan = baton({ id: 'b-rival-cyan', code: 'CYANS0UTH2', serial: 2, mode: 'rival', title: 'North vs South · Lena Vogel', path: cyanPath, createdAt: now - 3 * DAY, updatedAt: now - 9 * HOUR, rivalId: 'rival-ns' })
  const coastGold = baton({ id: 'b-coast-gold', code: 'C0ASTG0LD3', serial: 3, mode: 'rival', title: 'Coast Cup · Ada Obi', path: [ada, lena, mei, arjun, sam, wanjiru, thandi, ada], createdAt: now - 9 * DAY, updatedAt: now - 3 * DAY, status: 'completed', rivalId: 'rival-coast' })
  const coastCyan = baton({ id: 'b-coast-cyan', code: 'C0ASTCYAN4', serial: 4, mode: 'rival', title: 'Coast Cup · Thandi M', path: [thandi, wanjiru, mei, lena, ada, arjun, sam, lena, mei, arjun, thandi], createdAt: now - 9 * DAY, updatedAt: now - 3 * DAY, status: 'completed', rivalId: 'rival-coast' })
  const rivals: NetworkRival[] = [
    { id: 'rival-ns', title: 'North vs South', batonIds: [gold.id, cyan.id], target: 10, scores: [gold.handoffCount, cyan.handoffCount], winnerId: null, createdAt: now - 3 * DAY, endsAt: now + 4 * DAY - 5 * HOUR },
    { id: 'rival-coast', title: 'Coast Cup', batonIds: [coastGold.id, coastCyan.id], target: 10, scores: [coastGold.handoffCount, coastCyan.handoffCount], winnerId: coastCyan.id, createdAt: now - 9 * DAY, endsAt: now - 2 * DAY },
  ]

  // Lena reserved her Quick match's next leg for Mateo three hours ago; he hasn't accepted yet.
  const sunday: NetworkBaton = {
    ...baton({ id: 'b-sunday', code: 'SUNDAY5PRT', serial: 2, mode: 'quick', title: 'Sunday sprint', path: [lena], createdAt: now - 3 * HOUR, updatedAt: now - 3 * HOUR, recipientId: mateo.id }),
    recipientReservedAt: now - 3 * HOUR,
    quick: { players: [lena.id, mateo.id], bestOf: 3, scores: { [lena.id]: 0, [mateo.id]: 0 }, rounds: 0, winnerId: null, rematchOf: null },
  }

  // Aurora passed its tenth verified handoff.
  const auroraPath = [ada, lena, arjun, mei, sam, wanjiru, thandi, ada, lena, arjun, mei]
  const aurora = baton({ id: 'b-aurora', code: 'AUR0RA10XQ', serial: 2, mode: 'global', title: 'Aurora', path: auroraPath, createdAt: now - 12 * DAY, updatedAt: now - 30 * HOUR })
  const auroraHandoffs = handoffsAlong(aurora, auroraPath, auroraPath.slice(1).map((_, index) => ({ at: now - (12 - index) * DAY + 5 * HOUR })), 400)

  const snapshot = {
    ...base.snapshot,
    batons: [global, sunday, crewBaton, gold, cyan, aurora, oldCrew, coastGold, coastCyan, ...base.snapshot.batons.filter(item => item.id !== global.id && item.id !== 'b-crew')],
    crews: [crew, otherCrew],
    rivals,
    daily: {
      ...base.snapshot.daily,
      officialRunId: 'daily-mateo',
      leaderboard: [
        { player: mei, runId: 'daily-1', score: 21_340, timeMs: 58_120 },
        { player: arjun, runId: 'daily-2', score: 19_870, timeMs: 60_040 },
        { player: mateo, runId: 'daily-mateo', score: 19_410, timeMs: 59_210 },
        { player: lena, runId: 'daily-4', score: 18_800, timeMs: 61_330 },
        { player: ada, runId: 'daily-5', score: 17_650, timeMs: 62_010 },
        { player: wanjiru, runId: 'daily-6', score: 16_200, timeMs: 63_870 },
        { player: sam, runId: 'daily-7', score: 15_120, timeMs: 65_400 },
        { player: thandi, runId: 'daily-8', score: 12_900, timeMs: 70_050 },
      ],
    },
  }

  const mateoLeg = crewHandoffs[1]
  if (!mateoLeg) throw new Error('crew baton lost Mateo’s leg')
  const mateoProfile: RunnerProfile = {
    ...profileOf(mateo, snapshot),
    level: 3,
    seasonRank: 'Courier',
    qualifiedHandoffs: 12,
    legs: 14,
    ghostWins: 5,
    ghostLosses: 2,
    quick: { wins: 2, losses: 1 },
    crew: { name: crew.name, streak: crew.streak },
    daily: { bestTimeMs: 59_210, entries: 9 },
    historicBatons: [
      { id: global.id, code: global.code, displayName: global.displayName, handoffCount: global.handoffCount, role: 'holder' },
      { id: crewBaton.id, code: crewBaton.code, displayName: crewBaton.displayName, handoffCount: crewBaton.handoffCount, role: 'runner' },
      { id: gold.id, code: gold.code, displayName: gold.displayName, handoffCount: gold.handoffCount, role: 'origin' },
      { id: oldCrew.id, code: oldCrew.code, displayName: oldCrew.displayName, handoffCount: oldCrew.handoffCount, role: 'origin' },
    ],
    achievements: [
      { id: 'first-pass', title: 'FIRST PASS', unlockedAt: midnight - 6 * DAY + 10 * HOUR },
      { id: 'handoffs-10', title: '10 VERIFIED HANDOFFS', unlockedAt: midnight - 2 * DAY + 14 * HOUR },
      { id: 'crew-keeper', title: 'CREW KEEPER', unlockedAt: midnight - DAY + 9 * HOUR },
    ],
    artifacts: [
      { id: 'a-3', kind: 'crew-keeper', title: 'CREW KEEPER', subtitle: 'Rift Valley Runners · 7-day streak', batonId: null, leg: null, at: midnight - DAY + 9 * HOUR },
      { id: 'a-2', kind: 'handoffs-10', title: '10 VERIFIED HANDOFFS', subtitle: `${crewBaton.displayName} · Handoff 1`, batonId: crewBaton.id, leg: 1, at: midnight - 2 * DAY + 14 * HOUR },
      { id: 'a-1', kind: 'first-pass', title: 'FIRST PASS', subtitle: `${oldCrew.displayName} · Handoff 1`, batonId: oldCrew.id, leg: 1, at: midnight - 6 * DAY + 10 * HOUR },
    ],
    recentRunners: [wanjiru, thandi, mei, ada, lena].map(item => ({ name: item.name, handle: item.handle })),
  }

  const account = signedInAs(mateo, snapshot)
  account.snapshot.inbox.push({ id: 'n-4', type: 'rival_update', title: 'Your team’s baton moved', body: 'North vs South', batonId: gold.id, runId: null, createdAt: now - 26 * HOUR, readAt: now - 20 * HOUR })

  return {
    snapshot,
    details: {
      ...base.details,
      [crewBaton.code]: detailOf(crewBaton, crewHandoffs),
      [oldCrew.code]: detailOf(oldCrew, oldCrewHandoffs),
      [aurora.code]: detailOf(aurora, auroraHandoffs),
    },
    profiles: { mateo: mateoProfile },
    replays: { [mateoLeg.runId]: replayOf(mateoLeg) },
    account,
  }
}
