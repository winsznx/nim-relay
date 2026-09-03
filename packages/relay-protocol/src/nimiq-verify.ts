import {
  getPublicKeyAsync as ed25519GetPublicKey,
  signAsync as ed25519Sign,
  verifyAsync as ed25519Verify,
  hashes,
} from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import { blake2b } from '@noble/hashes/blake2.js'

/**
 * Nimiq "signed message" verification, matching the canonical Rust
 * implementation exactly (nimiq/core-rs-albatross, wallet/src/wallet_account.rs,
 * confirmed by reading the actual source - see DECISIONS.md D-002):
 *
 *   buffer = 0x16 ++ "Nimiq Signed Message:\n" ++ decimalAsciiByteLength(message) ++ message
 *   hash   = SHA-256(buffer)
 *   valid  = Ed25519.verify(signature, hash, publicKey)
 *
 * Address derivation (keys/src/address.rs): the first 20 bytes of
 * Blake2b-256 of the raw 32-byte Ed25519 public key. Note this is Blake2b,
 * distinct from the SHA-256 used for the message hash above - the two must
 * not be conflated.
 *
 * Never uses @nimiq/core's WASM crypto module here - it doesn't run inside
 * Cloudflare Workers (DECISIONS.md D-001). Uses pure-JS @noble primitives
 * instead, which do.
 */

// @noble/ed25519 needs a sha512 implementation wired in for its own internal
// hashing (RFC 8032 signature verification) - independent of the SHA-256
// used for the Nimiq message hash below.
hashes.sha512 = sha512

const SIGN_PREFIX = new Uint8Array([
  0x16,
  ...new TextEncoder().encode('Nimiq Signed Message:\n'),
])

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

async function nimiqMessageHash(message: Uint8Array): Promise<Uint8Array> {
  const lengthPrefix = new TextEncoder().encode(String(message.length))
  const buffer = concatBytes(SIGN_PREFIX, lengthPrefix, message)
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(buffer))
  return new Uint8Array(digest)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

export function deriveNimiqAddress(publicKey: Uint8Array): Uint8Array {
  const digest = blake2b(publicKey, { dkLen: 32 })
  return digest.slice(0, 20)
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) throw new RangeError(`hexToBytes: odd-length hex string`)
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/**
 * Produce a Nimiq signed message. Not on the trust path - verification is
 * (`verifyNimiqSignedMessage`). This exists for offline tooling and tests
 * that need a signature without driving a real device. Real logins are
 * signed by the wallet via the Mini App SDK's `sign()`.
 */
export async function signNimiqSignedMessage(input: {
  message: string
  privateKeyHex: string
}): Promise<string> {
  const hash = await nimiqMessageHash(new TextEncoder().encode(input.message))
  const signature = await ed25519Sign(hash, hexToBytes(input.privateKeyHex))
  return bytesToHex(signature)
}

export async function nimiqPublicKeyFromPrivate(privateKeyHex: string): Promise<string> {
  return bytesToHex(await ed25519GetPublicKey(hexToBytes(privateKeyHex)))
}

export interface VerifyNimiqSignedMessageInput {
  message: string
  signatureHex: string
  publicKeyHex: string
}

/** Verifies a Nimiq signed message and returns whether it's valid - never throws on malformed hex/signature input. */
export async function verifyNimiqSignedMessage(input: VerifyNimiqSignedMessageInput): Promise<boolean> {
  try {
    const messageBytes = new TextEncoder().encode(input.message)
    const hash = await nimiqMessageHash(messageBytes)
    const signature = hexToBytes(input.signatureHex)
    const publicKey = hexToBytes(input.publicKeyHex)
    return await ed25519Verify(signature, hash, publicKey)
  } catch {
    return false
  }
}
