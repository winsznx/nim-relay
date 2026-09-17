import { describe, expect, it } from 'vitest'
import { MAX_RELAY_NOTE_CHARS, type BatonHandoff, type NetworkRunner, type RelayNote } from '@nim-relay/shared'
import { ApiError } from '../model'
import { handoffForViewer, moderateNote, publicNoteText, sameNote } from './notes'

function moderated(text: string, visibility: RelayNote['visibility'] = 'public'): RelayNote | null | string {
  try {
    return moderateNote({ text, visibility })
  } catch (error) {
    if (error instanceof ApiError) return error.code
    throw error
  }
}

describe('relay note normalization', () => {
  it('trims and collapses whitespace, line breaks and tabs', () => {
    // #when a note arrives padded and spread over lines
    // #then it reads as one line with single spaces
    expect(moderated('  good   luck\n\tout\r\nthere  ')).toEqual({ text: 'good luck out there', visibility: 'public' })
  })

  it('strips control, zero-width and direction-override characters', () => {
    // #given invisible characters inside and between words
    const note = 'ru\u200Bn \u200D fast\u202E\u0007!'
    // #then only what a reader can see is kept
    expect(moderated(note)).toEqual({ text: 'run fast!', visibility: 'public' })
  })

  it('reads a blank note as no note', () => {
    // #when the text is only spaces and invisible characters
    // #then the pass carries no note
    expect([moderated('   '), moderated('\u200B\u2060'), moderateNote(null), moderateNote(undefined)]).toEqual([null, null, null, null])
  })

  it('keeps the visibility the sender chose', () => {
    // #then a private note stays private
    expect(moderated('see you at the finish', 'private')).toEqual({ text: 'see you at the finish', visibility: 'private' })
  })
})

describe('relay note length', () => {
  it('accepts exactly 48 characters once normalized, counting emoji as one', () => {
    // #given a note of 47 letters and one emoji, padded with spaces
    const text = `  ${'a'.repeat(MAX_RELAY_NOTE_CHARS - 1)}🔥   `
    // #then it fits
    expect(moderated(text)).toEqual({ text: `${'a'.repeat(MAX_RELAY_NOTE_CHARS - 1)}🔥`, visibility: 'public' })
  })

  it('refuses 49 characters, and oversized raw input before normalizing it', () => {
    // #then one character over the limit, and a huge padded note, are both too long
    expect([moderated('a'.repeat(MAX_RELAY_NOTE_CHARS + 1)), moderated(' '.repeat(10_000))]).toEqual(['note_too_long', 'note_too_long'])
  })
})

describe('relay note contact details', () => {
  it.each([
    ['a URL', 'watch https://relay.example'],
    ['a bare domain', 'find me at example.com'],
    ['a spelled-out domain', 'example dot com'],
    ['www', 'www.relay'],
    ['a full-width domain', 'ｗｗｗ．relay'],
    ['a short link', 't.me/runner'],
    ['an @handle', 'follow @courier'],
    ['an email address', 'mail me: a.runner@post.cc'],
    ['a phone number', 'call +1 (555) 123-4567'],
    ['a local phone number', 'text 555 1234'],
    ['a Nimiq address', 'tip NQ07 0000 1111 2222'],
    ['a hex address', 'send to 0xdeadbeef01'],
    ['an address-like token', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p'],
  ])('refuses %s', (_case, text) => {
    // #then the note cannot travel with the baton
    expect(moderated(text)).toBe('note_not_allowed')
  })

  it.each([
    ['a spaced @', 'meet you @ the gate'],
    ['a clock time', 'go at 12:30'],
    ['a split time', 'leg 10 in 38.42s'],
    ['a score', '180000 points!'],
    ['a sentence break', 'fast leg. net win'],
  ])('allows %s', (_case, text) => {
    // #then the note travels unchanged
    expect(moderated(text)).toEqual({ text, visibility: 'public' })
  })
})

describe('relay note language', () => {
  it('masks profanity as whole words in any case, including look-alike digits and accents', () => {
    // #when a note swears three ways
    // #then each word keeps its first letter and nothing else
    expect(moderated('Holy SHIT, sh1t and fück')).toEqual({ text: 'Holy S***, s*** and f***', visibility: 'public' })
  })

  it('leaves words that only contain a masked word alone', () => {
    // #then whole-word matching spares longer words
    expect(moderated('pass the class, grass is green')).toEqual({ text: 'pass the class, grass is green', visibility: 'public' })
  })

  it('refuses slurs, whole or spelled out letter by letter', () => {
    // #given a slur in capitals and one spaced out
    const slur = String.fromCharCode(102, 97, 103)
    // #then both notes are refused, while a word containing the letters is not
    expect([moderated(`you ${slur.toUpperCase()}`), moderated(`you ${slur.split('').join(' ')}`), moderated('fagus trees')]).toEqual([
      'note_not_allowed',
      'note_not_allowed',
      { text: 'fagus trees', visibility: 'public' },
    ])
  })
})

describe('relay note visibility', () => {
  const runner = (id: string): NetworkRunner => ({ id, handle: `runner-${id}`, name: id, wallet: `NQ00${id}`, country: null, countrySource: null })
  const handoff = (note: RelayNote | null): BatonHandoff => ({
    id: 'h1', batonId: 'b1', leg: 1, from: runner('sender'), to: runner('recipient'), value: 100_000, txHash: 'a'.repeat(64), network: 'TestAlbatross', at: 0,
    runId: 'r1', resultHash: 'hash', qualified: true, confirmations: 2, blockNumber: 1, sector: 0, race: null, rescue: false, note,
    atlas: { routeId: 'genesis-to-cape-verdigris', origin: 'genesis', destination: 'cape-verdigris', backfilled: false, onCourse: true },
  })

  it('shows a private note to its sender and recipient only', () => {
    // #given a handoff with a private note
    const passed = handoff({ text: 'for you', visibility: 'private' })
    // #when each viewer reads it
    const seen = ['sender', 'recipient', 'someone-else', null].map(viewer => handoffForViewer(passed, viewer).note?.text ?? null)
    // #then only the two runners of the pass see it
    expect(seen).toEqual(['for you', 'for you', null, null])
  })

  it('shows a public note to everyone and keeps private text out of public records', () => {
    // #given a public and a private note
    const open: RelayNote = { text: 'for all', visibility: 'public' }
    const secret: RelayNote = { text: 'for you', visibility: 'private' }
    // #then a signed-out reader sees the public note, and only public text reaches public records
    expect([handoffForViewer(handoff(open), null).note, publicNoteText(open), publicNoteText(secret), publicNoteText(null)]).toEqual([open, 'for all', null, null])
  })

  it('compares notes by text and visibility', () => {
    // #given a note
    const note: RelayNote = { text: 'go', visibility: 'public' }
    // #then only the same text with the same visibility, or no note on both sides, is the same note
    expect([sameNote(note, { ...note }), sameNote(note, { ...note, visibility: 'private' }), sameNote(note, null), sameNote(null, null)]).toEqual([true, false, false, true])
  })
})
