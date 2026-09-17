/**
 * Built-in word lists for Relay Note moderation, lowercase and ROT13-encoded so code search and review never surface
 * the words themselves. Matching is whole-word; see `moderateNote` in ./notes.
 */

/** Profanity: masked in place, the note is still accepted. */
const MASKED_ROT13 =
  'shpx shpxf shpxvat shpxre shpxref shpxrq zbgureshpxre fuvg fuvgf fuvggl ohyyfuvg ovgpu ovgpurf nff nffubyr nffubyrf qhzonff wnpxnff qvpx qvpxurnq phag phagf onfgneq jnaxre gjng cevpx fyhg juber qbhpur qbhpuront cvff cvffrq pbpx obyybpxf'

/** Slurs: the note is refused. */
const REFUSED_ROT13 =
  'avttre avttref avttn avttnf fnaqavttre snttbg snttbgf snt sntf xvxr xvxrf fcvp fcvpf puvax puvaxf tbbx tbbxf jrgonpx jrgonpxf ornare ornaref enturnq gbjryurnq mvccreurnq pbba pbbaf cnxv cnxvf genaal genaavrf furznyr qlxr qlxrf ergneq ergneqf wvtnobb cbepuzbaxrl'

function rot13(value: string): string {
  return value.replace(/[a-z]/g, letter => String.fromCharCode(((letter.charCodeAt(0) - 97 + 13) % 26) + 97))
}

function decodeList(encoded: string): ReadonlySet<string> {
  return new Set(encoded.split(' ').map(rot13))
}

export const MASKED_WORDS = decodeList(MASKED_ROT13)
export const REFUSED_WORDS = decodeList(REFUSED_ROT13)
