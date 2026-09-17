import { MAX_RELAY_NOTE_CHARS, type BatonHandoff, type RelayNote } from '@nim-relay/shared'
import { z } from 'zod'
import { ApiError } from '../model'
import { MASKED_WORDS, REFUSED_WORDS } from './note-words'

/**
 * Relay Notes: the short message a sender leaves with a pass. A note is normalized and moderated once, when the
 * handoff is prepared, and that exact text is what the commitment binds, the intent keeps and the handoff shows.
 */

export const relayNoteInput = z.object({ text: z.string(), visibility: z.enum(['public', 'private']) })
export type RelayNoteInput = z.infer<typeof relayNoteInput>

/** Raw text past this many UTF-16 units is refused before normalizing, which keeps moderation work bounded. */
const MAX_RAW_NOTE_UNITS = 16 * MAX_RELAY_NOTE_CHARS

const WHITESPACE = /\s+/gu
/**
 * Controls, format characters (zero-width spaces and joiners, bidi overrides, soft hyphens), lone surrogates, private
 * use characters, and fillers that render as blanks: the combining grapheme joiner and the Hangul fillers.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\u034F\u115F\u1160\u3164\uFFA0]/gu

const DOMAIN_ENDINGS = [
  'com', 'net', 'org', 'io', 'co', 'xyz', 'app', 'dev', 'gg', 'me', 'ly', 'link', 'info', 'biz', 'ru', 'cn', 'tk', 'top', 'site', 'online', 'shop', 'club',
  'live', 'pro', 'tv', 'cc', 'ws', 'ai', 'fun', 'bet', 'vip', 'uk', 'de', 'fr', 'eu', 'us', 'ca', 'nl', 'br', 'au', 'eth', 'sol', 'crypto', 'nft',
]

/** Ways to reach someone outside the relay, matched against lowercase normalized text. */
const CONTACT_PATTERNS: readonly RegExp[] = [
  // URL schemes and www.
  /[a-z][a-z0-9+.-]*:\/\//,
  /\bwww\s*\./,
  // Domains, including "name [.] com", "name (.) com" and "name dot com".
  new RegExp(`[a-z0-9-](?:\\.|\\s*\\[\\.\\]\\s*|\\s*\\(\\.\\)\\s*|\\s+dot\\s+)(?:${DOMAIN_ENDINGS.join('|')})\\b`),
  /[a-z0-9-]\.[a-z]{2,}\/\S/,
  // @handles, and with them email addresses.
  /@[\p{L}\p{N}_]/u,
  // Phone-number-like: seven or more digits, however they are grouped.
  /\+?\d(?:[\s().\-/]*\d){6,}/,
  // Wallet addresses: Nimiq (NQ + check digits + groups of four) and hex.
  /\bnq\d{2}(?:\s?[0-9a-z]{4}){2,}/,
  /\b0x[0-9a-f]{6,}/,
]
/** Letters and digits run together this long are an address or a key, never a word. */
const ADDRESS_LIKE_TOKEN = /[0-9a-z]{20,}/g

const WORD = /[\p{L}\p{N}$]+/gu
const LOOK_ALIKES: Readonly<Record<string, string>> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', $: 's' }

/** NFKC folds full-width and compatibility forms, so "ｗｗｗ．" is judged, and kept, as "www.". */
export function normalizeNoteText(raw: string): string {
  return raw.normalize('NFKC').replace(WHITESPACE, ' ').replace(INVISIBLE, '').replace(WHITESPACE, ' ').trim()
}

/**
 * The note a pass carries, or null without one. Blank text is no note. Refuses text over MAX_RELAY_NOTE_CHARS code
 * points once normalized (`note_too_long`), contact details and slurs (`note_not_allowed`), and masks profanity.
 */
export function moderateNote(input: RelayNoteInput | null | undefined): RelayNote | null {
  if (!input) return null
  if (input.text.length > MAX_RAW_NOTE_UNITS) throw new ApiError('note_too_long')
  const text = normalizeNoteText(input.text)
  if (text === '') return null
  if (Array.from(text).length > MAX_RELAY_NOTE_CHARS) throw new ApiError('note_too_long')
  if (sharesContact(text) || hasRefusedWord(text)) throw new ApiError('note_not_allowed')
  return { text: maskProfanity(text), visibility: input.visibility }
}

export function sameNote(a: RelayNote | null, b: RelayNote | null): boolean {
  if (a === null || b === null) return a === b
  return a.text === b.text && a.visibility === b.visibility
}

/** The handoff as `viewerId` may read it: a private note reaches only its sender and recipient. Null reads signed out. */
export function handoffForViewer(handoff: BatonHandoff, viewerId: string | null): BatonHandoff {
  if (handoff.note?.visibility !== 'private') return handoff
  if (viewerId !== null && (viewerId === handoff.from.id || viewerId === handoff.to.id)) return handoff
  return { ...handoff, note: null }
}

export function publicNoteText(note: RelayNote | null): string | null {
  return note?.visibility === 'public' ? note.text : null
}

function sharesContact(text: string): boolean {
  const lower = text.toLowerCase()
  if (CONTACT_PATTERNS.some(pattern => pattern.test(lower))) return true
  return (lower.match(ADDRESS_LIKE_TOKEN) ?? []).some(token => /[a-z]/.test(token) && /\d/.test(token))
}

/** Whole words, plus single letters spaced out to spell one ("s l u r"). */
function hasRefusedWord(text: string): boolean {
  const words = text.match(WORD) ?? []
  if (words.some(word => REFUSED_WORDS.has(wordSkeleton(word)))) return true
  let spelled = ''
  for (const word of [...words, '']) {
    if (Array.from(word).length === 1) {
      spelled += word
      continue
    }
    if (spelled.length > 1 && REFUSED_WORDS.has(wordSkeleton(spelled))) return true
    spelled = ''
  }
  return false
}

function maskProfanity(text: string): string {
  return text.replace(WORD, word => (MASKED_WORDS.has(wordSkeleton(word)) ? mask(word) : word))
}

function mask(word: string): string {
  const [first = '', ...rest] = Array.from(word)
  return first + '*'.repeat(rest.length)
}

/** Lowercase without accents; in a word that has letters, digits and "$" read as the letters they stand in for. */
function wordSkeleton(word: string): string {
  const plain = word.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  if (!/\p{L}/u.test(plain)) return plain
  return plain.replace(/[0-9$]/g, character => LOOK_ALIKES[character] ?? character)
}
