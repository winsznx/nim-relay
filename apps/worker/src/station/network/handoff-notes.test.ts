import { beforeAll, describe, expect, it } from 'vitest'
import type { BatonChronicle, BatonDetail, NetworkHandoffIntent, NetworkSnapshot, RelayNote } from '@nim-relay/shared'
import { handoffCommitment } from './handoff'
import { api, call, chainTransfer, confirmWith, createBaton, joinNetwork, raceLeg, randomTxHash, runner, TEST_RUN_CHALLENGE_SECRET, type TestRunner } from './testing'

const DEFAULT_THROW = { angle: 45, power: 75 }

interface NotedPass {
  a: TestRunner
  b: TestRunner
  batonId: string
  batonCode: string
  intent: NetworkHandoffIntent
}

/** Races runner a's leg, prepares a pass to runner b carrying `note`, and verifies the transfer. */
async function passWithNote(note: RelayNote | null): Promise<NotedPass> {
  const [a, b] = [await runner(), await runner()]
  await joinNetwork(a, b)
  const journey = await createBaton(a, { mode: 'global', title: 'Noted pass' })
  const leg = await raceLeg(a, journey.baton.id)
  const prepared = await call<NetworkHandoffIntent>(a.cookie, '/network/handoff/prepare', { runId: leg.issued.runId, recipient: b.p.id, note })
  const intent = await call<NetworkHandoffIntent>(a.cookie, '/network/handoff/attempt', { id: prepared.id })
  const hash = randomTxHash()
  const confirmation = await confirmWith(a, intent, hash, chainTransfer(intent, hash))
  if (confirmation.status !== 'verified') throw new Error(`Handoff did not verify: ${confirmation.reason ?? 'unknown'}`)
  return { a, b, batonId: journey.baton.id, batonCode: journey.baton.code, intent }
}

async function noteOnBatonPage(batonId: string, cookie = ''): Promise<RelayNote | null | undefined> {
  return (await call<BatonDetail>(cookie, `/network/batons/${batonId}`)).handoffs[0]?.note
}

describe('relay note preparation', () => {
  it('stores the moderated note on the intent and keeps it out of transaction data', async () => {
    // #given a holder with a finished leg
    const [a, b] = [await runner(), await runner()]
    await joinNetwork(a, b)
    const journey = await createBaton(a, { mode: 'global', title: 'Padded note' })
    const leg = await raceLeg(a, journey.baton.id)
    // #when they prepare a pass with a padded note that swears
    const intent = await call<NetworkHandoffIntent>(a.cookie, '/network/handoff/prepare', { runId: leg.issued.runId, recipient: b.p.id, note: { text: '  keep   the shit moving ', visibility: 'public' } })
    // #then the intent keeps the moderated text and the transfer data is the usual relay commitment alone
    expect({ note: intent.note, data: /^NR1\.[A-Z0-9]+\.[0-9a-z]+\.[A-Za-z0-9_-]{22}$/.test(intent.data), carriesText: intent.data.includes('keep') }).toEqual({
      note: { text: 'keep the s*** moving', visibility: 'public' },
      data: true,
      carriesText: false,
    })
  })

  it('binds the note into the commitment the transfer carries', async () => {
    // #given a prepared pass with a private note
    const [a, b] = [await runner(), await runner()]
    await joinNetwork(a, b)
    const journey = await createBaton(a, { mode: 'global', title: 'Bound note' })
    const leg = await raceLeg(a, journey.baton.id)
    const intent = await call<NetworkHandoffIntent>(a.cookie, '/network/handoff/prepare', { runId: leg.issued.runId, recipient: b.p.id, note: { text: 'see you there', visibility: 'private' } })
    // #when the commitment is derived for the same terms with the stored note, another note, another visibility and none
    const terms = { id: intent.id, batonId: journey.baton.id, leg: intent.leg, runId: leg.issued.runId, from: a.p.id, to: b.p.id, throw: DEFAULT_THROW, route: intent.route }
    const commitments = await Promise.all([
      handoffCommitment(TEST_RUN_CHALLENGE_SECRET, { ...terms, note: intent.note }),
      handoffCommitment(TEST_RUN_CHALLENGE_SECRET, { ...terms, note: { text: 'see you later', visibility: 'private' } }),
      handoffCommitment(TEST_RUN_CHALLENGE_SECRET, { ...terms, note: { text: 'see you there', visibility: 'public' } }),
      handoffCommitment(TEST_RUN_CHALLENGE_SECRET, { ...terms, note: null }),
    ])
    // #then only the stored note reproduces the data commitment, and every variation changes it
    const carried = intent.data.split('.')[3]
    expect({ matches: commitments.map(commitment => commitment === carried), distinct: new Set(commitments).size }).toEqual({ matches: [true, false, false, false], distinct: 4 })
  })

  it('returns the open intent for the same note and refuses a different note or none', async () => {
    // #given a prepared pass with a note
    const [a, b] = [await runner(), await runner()]
    await joinNetwork(a, b)
    const journey = await createBaton(a, { mode: 'global', title: 'Locked note' })
    const leg = await raceLeg(a, journey.baton.id)
    const note: RelayNote = { text: 'go go go', visibility: 'public' }
    const prepare = (body: Record<string, unknown>) => api(a.cookie, '/network/handoff/prepare', { runId: leg.issued.runId, recipient: b.p.id, ...body })
    const first = await call<NetworkHandoffIntent>(a.cookie, '/network/handoff/prepare', { runId: leg.issued.runId, recipient: b.p.id, note })
    // #when the holder prepares again with the same note written differently, another note, another visibility and no note
    const same = await prepare({ note: { text: ' go  go go ', visibility: 'public' } })
    const refused = await Promise.all([prepare({ note: { text: 'go go', visibility: 'public' } }), prepare({ note: { ...note, visibility: 'private' } }), prepare({})])
    // #then only the same note returns the open intent
    expect({
      same: [same.status, ((await same.json()) as NetworkHandoffIntent).id === first.id],
      refused: await Promise.all(refused.map(async response => [response.status, await response.json()])),
    }).toEqual({
      same: [200, true],
      refused: [
        [409, { error: 'handoff_already_prepared' }],
        [409, { error: 'handoff_already_prepared' }],
        [409, { error: 'handoff_already_prepared' }],
      ],
    })
  })

  it('refuses a note that is too long or shares contact details before locking the pass', async () => {
    // #given a holder with a finished leg
    const [a, b] = [await runner(), await runner()]
    await joinNetwork(a, b)
    const journey = await createBaton(a, { mode: 'global', title: 'Refused notes' })
    const leg = await raceLeg(a, journey.baton.id)
    const prepare = (text: string) => api(a.cookie, '/network/handoff/prepare', { runId: leg.issued.runId, recipient: b.p.id, note: { text, visibility: 'public' } }).then(async response => [response.status, await response.json()])
    // #when the notes break the rules
    const outcomes = [await prepare('x'.repeat(49)), await prepare('dm me @runner'), await prepare('nimrelay.xyz/win')]
    // #then each is refused and no pass was locked
    const snapshot = await call<NetworkSnapshot>(a.cookie, '/network')
    expect({ outcomes, pending: snapshot.pendingHandoff }).toEqual({
      outcomes: [
        [400, { error: 'note_too_long' }],
        [400, { error: 'note_not_allowed' }],
        [400, { error: 'note_not_allowed' }],
      ],
      pending: null,
    })
  })
})

describe('a verified pass with a private note', () => {
  let pass: NotedPass
  let outsider: TestRunner

  beforeAll(async () => {
    pass = await passWithNote({ text: 'your turn, legend', visibility: 'private' })
    outsider = await runner()
  })

  it('shows the note on the baton page to the sender and recipient only', async () => {
    // #when the baton page is read by each runner, an outsider and a signed-out visitor
    const seen = [await noteOnBatonPage(pass.batonId, pass.a.cookie), await noteOnBatonPage(pass.batonId, pass.b.cookie), await noteOnBatonPage(pass.batonId, outsider.cookie), await noteOnBatonPage(pass.batonId)]
    // #then only the two runners of the pass read it
    const note: RelayNote = { text: 'your turn, legend', visibility: 'private' }
    expect(seen).toEqual([note, note, null, null])
  })

  it('keeps the note out of the public Chronicle', async () => {
    // #when the Chronicle is read
    const response = await api('', `/network/chronicles/${pass.batonCode}`)
    const text = await response.text()
    // #then neither the transaction nor the page carries the text
    expect({ note: (JSON.parse(text) as BatonChronicle).transactions[0]?.note, leaked: text.includes('legend') }).toEqual({ note: null, leaked: false })
  })

  it('hands the note to the recipient with the incoming baton', async () => {
    // #when the recipient reads their inbox
    const inbox = (await call<NetworkSnapshot>(pass.b.cookie, '/network')).inbox
    // #then the incoming baton carries it
    expect(inbox.find(notification => notification.type === 'incoming_baton' && notification.batonId === pass.batonId)?.note).toBe('your turn, legend')
  })
})

describe('a verified pass with a public note', () => {
  let pass: NotedPass

  beforeAll(async () => {
    pass = await passWithNote({ text: 'for everyone watching', visibility: 'public' })
  })

  it('shows the note on the baton page and in the Chronicle to everyone', async () => {
    // #when a signed-out visitor reads both
    const chronicle = await call<BatonChronicle>('', `/network/chronicles/${pass.batonCode}`)
    // #then both carry it
    expect([await noteOnBatonPage(pass.batonId), chronicle.transactions[0]?.note]).toEqual([{ text: 'for everyone watching', visibility: 'public' }, 'for everyone watching'])
  })
})

describe('a verified pass without a note', () => {
  it('records no note and tells the recipient so', async () => {
    // #given a pass prepared without a note
    const pass = await passWithNote(null)
    // #when the baton page and the recipient's inbox are read
    const inbox = (await call<NetworkSnapshot>(pass.b.cookie, '/network')).inbox
    // #then both say there is none
    expect([await noteOnBatonPage(pass.batonId), inbox.find(notification => notification.type === 'incoming_baton')?.note]).toEqual([null, null])
  })
})
