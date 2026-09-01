/**
 * PRD section 9.5 - Transaction data commitment.
 *
 * Nimiq basic-transaction data is limited (send-with-data cap ~64 bytes per
 * the Web Client "send transactions" guide - see docs/PHASE_0_VERIFICATION.md
 * section 3). NIM Relay encodes a compact ASCII commitment into that field
 * that binds the on-chain transaction to a full off-chain HandoffIntent
 * without putting the full intent on-chain.
 *
 * Shape: NR1.<relayCode>.<legCode>.<commitment>
 *  - version:    literal "NR1" (bump on breaking format change)
 *  - relayCode:  the relay's stable public_code, [A-Za-z0-9]{1,12}
 *  - legCode:    leg_number encoded base36, lowercase
 *  - commitment: first 128 bits of SHA-256(intentHash) encoded base64url, no padding
 *
 * Target: strictly under 64 UTF-8 bytes total.
 */

const MAX_BYTES = 64
const VERSION = 'NR1'
const RELAY_CODE_PATTERN = /^[A-Za-z0-9]{1,12}$/
const LEG_CODE_PATTERN = /^[0-9a-z]{1,6}$/
// 22 base64url chars encode 128 bits (16 bytes) with no padding.
const COMMITMENT_PATTERN = /^[A-Za-z0-9_-]{22}$/

export interface TxDataCommitment {
  version: string
  relayCode: string
  legNumber: number
  commitment: string
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Copies into a fresh, plain ArrayBuffer - crypto.subtle.digest rejects the
 * wider Uint8Array<ArrayBufferLike> shape TS infers for arbitrary inputs. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

/** Derives the 128-bit compact commitment from a full intent hash (hex or bytes). */
export async function deriveCommitment(intentHash: string | Uint8Array): Promise<string> {
  const bytes =
    typeof intentHash === 'string'
      ? new Uint8Array(intentHash.match(/.{1,2}/g)?.map((b) => Number.parseInt(b, 16)) ?? [])
      : intentHash
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes)))
  return toBase64Url(digest.slice(0, 16)) // 128 bits
}

export function legNumberToCode(legNumber: number): string {
  if (!Number.isInteger(legNumber) || legNumber < 0) {
    throw new RangeError(`legNumberToCode: invalid leg number ${legNumber}`)
  }
  return legNumber.toString(36)
}

export function legCodeToNumber(legCode: string): number {
  if (!LEG_CODE_PATTERN.test(legCode)) {
    throw new RangeError(`legCodeToNumber: malformed leg code ${legCode}`)
  }
  return Number.parseInt(legCode, 36)
}

export function encodeTxData(input: { relayCode: string; legNumber: number; commitment: string }): string {
  if (!RELAY_CODE_PATTERN.test(input.relayCode)) {
    throw new RangeError(`encodeTxData: malformed relayCode ${input.relayCode}`)
  }
  if (!COMMITMENT_PATTERN.test(input.commitment)) {
    throw new RangeError(`encodeTxData: malformed commitment ${input.commitment}`)
  }
  const legCode = legNumberToCode(input.legNumber)
  const encoded = `${VERSION}.${input.relayCode}.${legCode}.${input.commitment}`
  const byteLength = new TextEncoder().encode(encoded).length
  if (byteLength > MAX_BYTES) {
    throw new RangeError(`encodeTxData: ${byteLength} bytes exceeds ${MAX_BYTES}-byte budget`)
  }
  return encoded
}

/** Returns null (never throws) on malformed input - callers must reject, not crash, on chain data. */
export function decodeTxData(raw: string): TxDataCommitment | null {
  const parts = raw.split('.')
  if (parts.length !== 4) return null
  const [version, relayCode, legCode, commitment] = parts as [string, string, string, string]
  if (version !== VERSION) return null
  if (!RELAY_CODE_PATTERN.test(relayCode)) return null
  if (!LEG_CODE_PATTERN.test(legCode)) return null
  if (!COMMITMENT_PATTERN.test(commitment)) return null
  return { version, relayCode, legNumber: legCodeToNumber(legCode), commitment }
}
