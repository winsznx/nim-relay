import { describe, expect, it } from 'vitest'
import { batonMilestone, cardLayout, resultHeadline, type ChronicleCard, type CrewCard, type DailyCard, type HandoffCard, type ResultCard, type RivalCard } from './layout'

const result: ResultCard = {
  kind: 'result',
  runner: { name: 'Tim Weber', handle: 'tim' },
  world: 'coast',
  timeMs: 41_640,
  ghost: { name: 'Mariana', timeMs: 41_820 },
  perfectGates: { hit: 14, total: 16 },
  flowControl: 87,
  relay: { code: 'G7K2M9Q4XA', name: 'Aurora', leg: 4 },
}

const handoff: HandoffCard = {
  kind: 'handoff',
  from: { name: 'Tim', country: 'DE' },
  to: { name: 'Mariana', country: 'BR' },
  leg: 12,
  batonName: 'Aurora',
  code: 'G7K2M9Q4XA',
  valueLuna: 100_000,
  network: 'MainAlbatross',
}

const daily: DailyCard = { kind: 'daily', runnerName: 'Tim Weber', date: '2026-09-16', world: 'metro', timeMs: 58_120, rank: 3, total: 41, topPercent: 8 }

describe('result card', () => {
  it('states who beat whom by how much, from the runner’s side', () => {
    // #given a run 0.18 s faster than its ghost
    // #when the card is laid out
    const layout = cardLayout(result)
    // #then the headline is the race verdict
    expect(layout.headline).toBe('YOU BEAT MARIANA BY 0.18s')
  })

  it('names the ghost as the winner when the runner was slower', () => {
    expect(resultHeadline(42_000, { name: 'Mariana', timeMs: 41_820 })).toBe('MARIANA BEAT YOU BY 0.18s')
  })

  it('keeps a ghost’s full name together on one line', () => {
    // #given a two-word runner name
    // #then its words are joined by a no-break space the headline won't wrap at
    expect(resultHeadline(58_410, { name: 'Thandi M', timeMs: 60_120 })).toBe('YOU BEAT THANDI\u00a0M BY 1.71s')
  })

  it('reports a finish time when the leg raced no ghost', () => {
    expect(resultHeadline(58_120, null)).toBe('FINISHED IN 58.12s')
  })

  it('shows time, perfect gates and flow control with the world name', () => {
    // #when the card is laid out
    const layout = cardLayout(result)
    // #then every verified figure is present
    expect(layout.stats).toEqual([
      { value: '41.64s', label: 'TIME' },
      { value: '14/16', label: 'PERFECT GATES' },
      { value: '87%', label: 'FLOW CONTROL' },
    ])
    expect(layout.kicker).toBe('LEG 4 · SUNBREAK COAST')
  })

  it('leaves out figures the verified run doesn’t have', () => {
    // #given a historic run without metrics
    const layout = cardLayout({ ...result, perfectGates: null, flowControl: null })
    // #then only the time remains
    expect(layout.stats.map(stat => stat.label)).toEqual(['TIME'])
  })

  it('opens the relay journey for a baton leg and the runner otherwise', () => {
    expect(cardLayout(result).path).toBe('/relay/G7K2M9Q4XA')
    expect(cardLayout({ ...result, relay: null }).path).toBe('/runner/tim')
  })
})

describe('handoff card', () => {
  it('shows the pass, its number and the baton, verified on Nimiq', () => {
    // #when a consented handoff is laid out
    const layout = cardLayout(handoff)
    // #then it reads as the pass itself and links to the Chronicle
    expect(layout.headline).toBe('TIM\u00a0→ MARIANA')
    expect(layout.kicker).toBe('HANDOFF #12 · AURORA')
    expect(layout.badge).toBe('VERIFIED ON NIMIQ')
    expect(layout.caption).toBe('Germany → Brazil')
    expect(layout.path).toBe('/chronicle/G7K2M9Q4XA')
  })

  it('omits the country route unless both runners consented', () => {
    // #given a recipient without a shared country
    const layout = cardLayout({ ...handoff, to: { name: 'Mariana', country: null } })
    // #then no half route suggests a location
    expect(layout.caption).toBeNull()
  })
})

describe('daily card', () => {
  it('leads with the top percent and keeps time, rank and date', () => {
    // #when a ranked Daily ride is laid out
    const layout = cardLayout(daily)
    // #then
    expect(layout.headline).toBe('TOP 8% IN THE DAILY')
    expect(layout.kicker).toBe('DAILY CIRCUIT · WED, SEP 16')
    expect(layout.caption).toBe('Tim Weber on Midnight Metro')
    expect(layout.stats).toEqual([
      { value: '58.12s', label: 'TIME' },
      { value: '#3 of 41', label: 'RANK' },
      { value: '8%', label: 'TOP' },
    ])
    expect(layout.path).toBe('/daily')
  })

  it('falls back to the rank when the percentile is unknown or meaningless', () => {
    expect(cardLayout({ ...daily, topPercent: null }).headline).toBe('RANKED #3 IN THE DAILY')
    expect(cardLayout({ ...daily, rank: 41, topPercent: 100 }).headline).toBe('RANKED #41 IN THE DAILY')
    expect(cardLayout({ ...daily, topPercent: null }).stats.map(stat => stat.label)).toEqual(['TIME', 'RANK'])
  })
})

describe('crew card', () => {
  const crew: CrewCard = { kind: 'crew', crewName: 'CT Humbs', streak: 17, bestStreak: 21, members: 4, color: '#A18BFF' }

  it('writes the crew and its streak as one line', () => {
    // #when
    const layout = cardLayout(crew)
    // #then
    expect(layout.headline).toBe('CT HUMBS · 17-DAY RELAY STREAK')
    expect(layout.accent).toBe('#A18BFF')
    expect(layout.path).toBe('/crew')
    expect(layout.surface).toBe('crew')
  })

  it('keeps singular labels singular', () => {
    const layout = cardLayout({ ...crew, streak: 1, members: 1 })
    expect(layout.stats.map(stat => stat.label)).toEqual(['DAY', 'BEST STREAK', 'RUNNER'])
  })
})

describe('milestone card', () => {
  it('celebrates the largest wallet milestone actually reached', () => {
    // #given a baton with 53 transacting wallets
    const milestone = batonMilestone({ wallets: 53, handoffs: 60 })
    // #when
    const layout = cardLayout({ kind: 'milestone', batonName: 'Aurora', code: 'G7K2M9Q4XA', milestone: milestone ?? { count: 0, unit: 'wallets' }, handoffs: 60, wallets: 53, countries: 9, network: 'MainAlbatross' })
    // #then it claims 50, never 53 rounded up or a round number not reached
    expect(layout.headline).toBe('AURORA REACHED 50 WALLETS')
    expect(layout.path).toBe('/chronicle/G7K2M9Q4XA')
  })

  it('uses handoff milestones when wallets haven’t reached one, and nothing below both', () => {
    expect(batonMilestone({ wallets: 6, handoffs: 27 })).toEqual({ count: 25, unit: 'handoffs' })
    expect(batonMilestone({ wallets: 6, handoffs: 9 })).toBeNull()
  })
})

describe('chronicle card', () => {
  const chronicle: ChronicleCard = {
    kind: 'chronicle',
    code: 'G7K2M9Q4XA',
    identity: 'Global Relay #001',
    name: 'Aurora',
    network: 'TestAlbatross',
    valueLuna: 100_000,
    handoffs: 4,
    transactingWallets: 5,
    countries: 5,
    aliveMs: 31 * 3_600_000,
    route: 'Nigeria → Brazil',
    runnerNames: ['Ada', 'Lena', 'Arjun', 'Mei', 'Mateo', 'Sam'],
  }

  it('ports the journey card: identity, route, value and the runners who carried it', () => {
    // #when
    const layout = cardLayout(chronicle)
    // #then
    expect(layout.kicker).toBe('GLOBAL RELAY #001')
    expect(layout.headline).toBe('NIGERIA → BRAZIL')
    expect(layout.caption).toBe('Aurora, carrying 1 NIM')
    expect(layout.detail).toBe('Lena → Arjun → Mei → Mateo → Sam')
    // formatDuration keeps its parts together with a no-break space.
    expect(layout.stats.map(stat => stat.value)).toEqual(['4', '5', '5', '1d 7h'])
    expect(layout.footer).toBe('Nimiq testnet evidence, kept separate from mainnet usage.')
  })

  it('titles the card with the baton name while no country is on the route', () => {
    expect(cardLayout({ ...chronicle, route: null }).headline).toBe('AURORA')
  })

  it('doesn’t repeat an unnamed relay’s identity in the caption', () => {
    expect(cardLayout({ ...chronicle, name: 'Global Relay #001' }).caption).toBe('Carrying 1 NIM')
  })
})

describe('rival card', () => {
  const rival: RivalCard = { kind: 'rival', title: 'North vs South', target: 10, teams: [{ captain: 'Ada', score: 7 }, { captain: 'Lena', score: 4 }], winner: null }

  it('reports the leader and the score toward the target', () => {
    // #when
    const layout = cardLayout(rival)
    // #then
    expect(layout.headline).toBe('NORTH VS SOUTH')
    expect(layout.kicker).toBe('RIVALRY · FIRST TO 10')
    expect(layout.caption).toBe('Ada’s team leads 7–4')
    expect(layout.path).toBe('/rivals')
  })

  it('names the winner once a team reaches the target, and a tie as level', () => {
    expect(cardLayout({ ...rival, teams: [{ captain: 'Ada', score: 8 }, { captain: 'Lena', score: 10 }], winner: 'cyan' }).caption).toBe('Lena’s team won 8–10')
    expect(cardLayout({ ...rival, teams: [{ captain: 'Ada', score: 3 }, { captain: 'Lena', score: 3 }] }).caption).toBe('Level at 3–3')
  })
})
