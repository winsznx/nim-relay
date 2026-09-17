import { getPublicKeyAsync, signAsync } from '@noble/ed25519'
import { blake2b } from '@noble/hashes/blake2.js'
import { paymentAddress } from './address'
import { bytesToHex, deriveNimiqAddress, hexToBytes } from './nimiq-verify'

/**
 * Albatross basic transfers, built and signed without @nimiq/core, whose WASM does not run in workerd
 * (DECISIONS.md D-001). Byte layouts follow core-rs-albatross primitives/transaction/src/lib.rs and are pinned by test
 * vectors produced with @nimiq/core 2.21.0 (nimiq-transaction.test.ts):
 *
 *   content  = u16be(len data) data | sender 20 | sender type u8 | recipient 20 | recipient type u8
 *              | value u64be | fee u64be | validity start height u32be | network id u8 | flags u8 | varint(len sender data) sender data
 *   hash     = Blake2b-256(content)
 *   proof    = algorithm u8 (0 = Ed25519) | public key 32 | varint(len merkle path) | signature 64
 *   basic    = 0x00 | algorithm u8 | public key 32 | recipient 20 | value u64be | fee u64be | height u32be | network id u8 | signature 64
 *   extended = 0x01 | sender 20 | sender type u8 | varint(len) sender data | recipient 20 | recipient type u8
 *              | varint(len) data | value u64be | fee u64be | height u32be | network id u8 | flags u8 | varint(len) proof
 *
 * Transfers without data use the basic format, the rest the extended one, exactly as @nimiq/core chooses.
 */

export const NIMIQ_NETWORK_IDS = { TestAlbatross: 5, MainAlbatross: 24 } as const

const BASIC_ACCOUNT = 0
const ED25519_ALGORITHM = 0
const MAX_DATA_BYTES = 64
const MAX_LUNA = (1n << 64n) - 1n
const ADDRESS_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVXY'

export interface BasicTransferInput {
  /** 32-byte Ed25519 private key, hex. */
  privateKeyHex: string
  recipient: string
  valueLuna: bigint
  feeLuna: bigint
  validityStartHeight: number
  network: keyof typeof NIMIQ_NETWORK_IDS
  data?: Uint8Array
}

export interface SignedTransfer {
  /** Lowercase hex, as `sendRawTransaction` takes it. */
  serializedHex: string
  /** Lowercase hex, as the chain reports it. */
  hash: string
  sender: string
  recipient: string
  valueLuna: bigint
  feeLuna: bigint
  validityStartHeight: number
  network: keyof typeof NIMIQ_NETWORK_IDS
}

/** The 20 address bytes of a payment address such as "NQ07 0000 ...". Throws on a malformed address or a bad checksum. */
export function addressBytes(address: string): Uint8Array {
  const friendly = address.replace(/\s/g, '').toUpperCase()
  if (!/^NQ[0-9]{2}[0-9A-HJ-NP-VXY]{32}$/.test(friendly)) throw new RangeError('Invalid Nimiq address')
  const bytes = new Uint8Array(20)
  let accumulator = 0
  let bits = 0
  let index = 0
  for (const character of friendly.slice(4)) {
    accumulator = ((accumulator << 5) | ADDRESS_ALPHABET.indexOf(character)) & 0xffff
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes[index++] = (accumulator >>> bits) & 0xff
    }
  }
  if (paymentAddress(bytesToHex(bytes)) !== friendly) throw new RangeError('Invalid Nimiq address checksum')
  return bytes
}

export async function nimiqAddressFromPrivateKey(privateKeyHex: string): Promise<string> {
  const publicKey = await getPublicKeyAsync(privateKeyBytes(privateKeyHex))
  return paymentAddress(bytesToHex(deriveNimiqAddress(publicKey)))
}

export async function signBasicTransfer(input: BasicTransferInput): Promise<SignedTransfer> {
  const privateKey = privateKeyBytes(input.privateKeyHex)
  const recipient = addressBytes(input.recipient)
  const data = input.data ?? new Uint8Array()
  if (data.length > MAX_DATA_BYTES) throw new RangeError('Transfer data too long')
  assertLuna(input.valueLuna, 1n)
  assertLuna(input.feeLuna, 0n)
  if (!Number.isInteger(input.validityStartHeight) || input.validityStartHeight < 0 || input.validityStartHeight > 0xffffffff) throw new RangeError('Invalid validity start height')

  const publicKey = await getPublicKeyAsync(privateKey)
  const sender = deriveNimiqAddress(publicKey)
  if (bytesToHex(sender) === bytesToHex(recipient)) throw new RangeError('Transfer to the sending address')
  const networkId = NIMIQ_NETWORK_IDS[input.network]
  const amounts = concat(u64(input.valueLuna), u64(input.feeLuna), u32(input.validityStartHeight), [networkId])

  const content = concat(u16(data.length), data, sender, [BASIC_ACCOUNT], recipient, [BASIC_ACCOUNT], amounts, [0], varint(0))
  const signature = await signAsync(content, privateKey)
  const serialized = data.length === 0
    ? concat([0, ED25519_ALGORITHM], publicKey, recipient, amounts, signature)
    : extendedTransfer(sender, recipient, data, amounts, concat([ED25519_ALGORITHM], publicKey, varint(0), signature))

  return {
    serializedHex: bytesToHex(serialized),
    hash: bytesToHex(blake2b(content, { dkLen: 32 })),
    sender: paymentAddress(bytesToHex(sender)),
    recipient: paymentAddress(bytesToHex(recipient)),
    valueLuna: input.valueLuna,
    feeLuna: input.feeLuna,
    validityStartHeight: input.validityStartHeight,
    network: input.network,
  }
}

export interface ParsedTransfer {
  hash: string
  sender: string
  recipient: string
  valueLuna: bigint
  feeLuna: bigint
  validityStartHeight: number
  networkId: number
  data: Uint8Array
}

/**
 * Reads a signed basic transfer in either format back into its terms and hash, the way a node would before checking the
 * signature (which this does not do). For tests and local tooling; throws on anything else.
 */
export function parseSignedTransfer(serializedHex: string): ParsedTransfer {
  const bytes = hexToBytes(serializedHex)
  const reader = new ByteReader(bytes)
  let sender: Uint8Array
  let recipient: Uint8Array
  let data: Uint8Array = new Uint8Array()
  const format = reader.byte()
  if (format === 0) {
    reader.expect(ED25519_ALGORITHM)
    sender = deriveNimiqAddress(reader.take(32))
    recipient = reader.take(20)
  } else if (format === 1) {
    sender = reader.take(20)
    reader.expect(BASIC_ACCOUNT)
    if (reader.varint() !== 0) throw new RangeError('Not a basic transfer')
    recipient = reader.take(20)
    reader.expect(BASIC_ACCOUNT)
    data = reader.take(reader.varint())
  } else {
    throw new RangeError('Unknown transaction format')
  }
  const amounts = reader.take(21)
  if (format === 1) {
    reader.expect(0)
    reader.take(reader.varint())
  } else {
    reader.take(64)
  }
  if (!reader.done()) throw new RangeError('Trailing transaction bytes')
  const view = new DataView(amounts.buffer, amounts.byteOffset, amounts.byteLength)
  const content = concat(u16(data.length), data, sender, [BASIC_ACCOUNT], recipient, [BASIC_ACCOUNT], amounts, [0], varint(0))
  return {
    hash: bytesToHex(blake2b(content, { dkLen: 32 })),
    sender: paymentAddress(bytesToHex(sender)),
    recipient: paymentAddress(bytesToHex(recipient)),
    valueLuna: view.getBigUint64(0),
    feeLuna: view.getBigUint64(8),
    validityStartHeight: view.getUint32(16),
    networkId: view.getUint8(20),
    data,
  }
}

class ByteReader {
  private offset = 0
  constructor(private readonly bytes: Uint8Array) {}

  byte(): number {
    return this.take(1)[0]!
  }

  expect(value: number): void {
    if (this.byte() !== value) throw new RangeError('Not a basic Ed25519 transfer')
  }

  take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) throw new RangeError('Transaction bytes end early')
    const slice = this.bytes.slice(this.offset, this.offset + length)
    this.offset += length
    return slice
  }

  varint(): number {
    let value = 0
    for (let shift = 0; shift < 28; shift += 7) {
      const byte = this.byte()
      value |= (byte & 0x7f) << shift
      if ((byte & 0x80) === 0) return value
    }
    throw new RangeError('Length prefix too long')
  }

  done(): boolean {
    return this.offset === this.bytes.length
  }
}

function extendedTransfer(sender: Uint8Array, recipient: Uint8Array, data: Uint8Array, amounts: Uint8Array, proof: Uint8Array): Uint8Array {
  return concat([1], sender, [BASIC_ACCOUNT], varint(0), recipient, [BASIC_ACCOUNT], varint(data.length), data, amounts, [0], varint(proof.length), proof)
}

function privateKeyBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new RangeError('Invalid private key')
  return hexToBytes(hex)
}

function assertLuna(value: bigint, minimum: bigint): void {
  if (value < minimum || value > MAX_LUNA) throw new RangeError('Invalid Luna amount')
}

function u16(value: number): Uint8Array {
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff])
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value)
  return bytes
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, value)
  return bytes
}

/** Unsigned LEB128, as postcard writes lengths. */
function varint(value: number): Uint8Array {
  const bytes: number[] = []
  let rest = value
  do {
    const low = rest & 0x7f
    rest >>>= 7
    bytes.push(rest > 0 ? low | 0x80 : low)
  } while (rest > 0)
  return new Uint8Array(bytes)
}

function concat(...parts: ArrayLike<number>[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
