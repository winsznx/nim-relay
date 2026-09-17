import { describe, expect, it } from 'vitest'
import { addressBytes, nimiqAddressFromPrivateKey, parseSignedTransfer, signBasicTransfer, type BasicTransferInput } from './nimiq-transaction'
import { paymentAddress } from './address'

/**
 * Produced with @nimiq/core 2.21.0 in Node (TransactionBuilder.newBasic / newBasicWithData, Transaction.sign, serialize,
 * hash), by scripts/treasury/transaction-vectors.mjs. Ed25519 signatures are deterministic, so the signed bytes must match.
 */
const CORE_VECTORS = [
  {
    privateKeyHex: '1111111111111111111111111111111111111111111111111111111111111111',
    sender: 'NQ21 SEXP BY6P CVJG 8RQX UVFR BQFD FBD6 S5LD',
    recipient: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
    valueLuna: 100000n,
    feeLuna: 0n,
    validityStartHeight: 1234,
    network: 'TestAlbatross',
    data: null,
    serialized: '0000d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737000000000000000000000000000000000000000000000000000186a00000000000000000000004d205b87abbb1b37f25576b93408bf3c9e48c9d32dc6051237e6f3edf7e9e63d71fa93cfb78e89055beed8bc458b6ed71b03cc2c1e4eb7bde7d2d7d6dd546c4591608',
    hash: '05b59ef6bd38f3c5e5e987d922aeec6a10a44c9000530dced039c314d9f197b5',
  },
  {
    privateKeyHex: 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899',
    sender: 'NQ57 94NL F9LU 5EHL 1SSN 18AA FF1V FTC0 809T',
    recipient: 'NQ88 04HL ARU9 MF6X X093 8MKQ KAXD VU0J 6HB7',
    valueLuna: 150000n,
    feeLuna: 138n,
    validityStartHeight: 4294967295,
    network: 'MainAlbatross',
    data: 'NIM Relay starter grant',
    serialized: '01492d47a69c2ba340eb560a14a7bc3d7ed804013b00000123456789abcdef0123456789abcdef0123456700174e494d2052656c61792073746172746572206772616e7400000000000249f0000000000000008affffffff18006200cce0ca9ad24b8cba903f4c73c79fd50aa90953bc05d67c4299f72f071b672d5a00aa6185eb0b7af68f0ee868a1fd4e13fb4e8ea3d8113380bf66648a8fbea401eea1e99e6fbf937465d645208e693c9ef264e6472c20040ccd46eac738e828e705',
    hash: '5915e32ae8456a6627b918910001856ff1be7520d304ef64babdb6cbb6b840e2',
  },
  {
    privateKeyHex: '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0',
    sender: 'NQ17 RH1U JH27 59L3 4N5M LTSY P3UR P6Y0 MGDK',
    recipient: 'NQ88 04HL ARU9 MF6X X093 8MKQ KAXD VU0J 6HB7',
    valueLuna: 1n,
    feeLuna: 0n,
    validityStartHeight: 0,
    network: 'TestAlbatross',
    data: 'NRG1.starter',
    serialized: '01cc43c944472a683258b5a6f5fb8f99b9be0ac1b300000123456789abcdef0123456789abcdef01234567000c4e5247312e737461727465720000000000000001000000000000000000000000050062008e78d21d279ca513fc42c0be2dc96f4d879c70c182b5e53d77e7dcc7c9063a140048b9014b3254b239e3de7827675e5c006cc3b05712e9c0e231a38a0e20bcf8657161e04b7cb765f00d80a4cfd15e0eaa941eb71ac3438ae294c59214c5945304',
    hash: '0e5b45f127845fa94dbfbccfdf71b2beecee34038456d6829dccbd9fbf4625bd',
  },] as const

const spaced = (address: string) => address.replace(/\s/g, '')

describe('signBasicTransfer', () => {
  for (const vector of CORE_VECTORS) {
    it(`matches @nimiq/core byte for byte (${vector.data === null ? 'basic' : 'extended'}, ${vector.network})`, async () => {
      const input: BasicTransferInput = {
        privateKeyHex: vector.privateKeyHex,
        recipient: vector.recipient,
        valueLuna: vector.valueLuna,
        feeLuna: vector.feeLuna,
        validityStartHeight: vector.validityStartHeight,
        network: vector.network,
        ...(vector.data === null ? {} : { data: new TextEncoder().encode(vector.data) }),
      }
      const signed = await signBasicTransfer(input)
      expect(signed.serializedHex).toBe(vector.serialized)
      expect(signed.hash).toBe(vector.hash)
      expect(signed.sender).toBe(spaced(vector.sender))
      expect(signed.recipient).toBe(spaced(vector.recipient))
      expect(await nimiqAddressFromPrivateKey(vector.privateKeyHex)).toBe(spaced(vector.sender))
    })
  }

  const base: BasicTransferInput = { privateKeyHex: '11'.repeat(32), recipient: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000', valueLuna: 1n, feeLuna: 0n, validityStartHeight: 1, network: 'TestAlbatross' }

  it('refuses malformed input instead of signing it', async () => {
    await expect(signBasicTransfer({ ...base, valueLuna: 0n })).rejects.toThrow(RangeError)
    await expect(signBasicTransfer({ ...base, feeLuna: -1n })).rejects.toThrow(RangeError)
    await expect(signBasicTransfer({ ...base, validityStartHeight: -1 })).rejects.toThrow(RangeError)
    await expect(signBasicTransfer({ ...base, data: new Uint8Array(65) })).rejects.toThrow(RangeError)
    await expect(signBasicTransfer({ ...base, privateKeyHex: 'zz' })).rejects.toThrow(RangeError)
    await expect(signBasicTransfer({ ...base, recipient: CORE_VECTORS[0].sender })).rejects.toThrow('Transfer to the sending address')
  })

  it('never puts the private key into its output or its errors', async () => {
    const signed = await signBasicTransfer(base)
    expect(JSON.stringify(signed, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value))).not.toContain(base.privateKeyHex)
    const error = await signBasicTransfer({ ...base, valueLuna: 0n }).catch((caught: unknown) => caught)
    expect(String(error)).not.toContain(base.privateKeyHex)
  })
})

describe('parseSignedTransfer', () => {
  it('reads every @nimiq/core vector back into its terms and hash', () => {
    for (const vector of CORE_VECTORS) {
      const parsed = parseSignedTransfer(vector.serialized)
      expect(parsed.hash).toBe(vector.hash)
      expect([parsed.sender, parsed.recipient]).toEqual([spaced(vector.sender), spaced(vector.recipient)])
      expect([parsed.valueLuna, parsed.feeLuna, parsed.validityStartHeight, parsed.networkId]).toEqual([vector.valueLuna, vector.feeLuna, vector.validityStartHeight, vector.network === 'TestAlbatross' ? 5 : 24])
      expect(new TextDecoder().decode(parsed.data)).toBe(vector.data ?? '')
    }
  })

  it('rejects truncated or padded bytes', () => {
    const [vector] = CORE_VECTORS
    expect(() => parseSignedTransfer(vector.serialized.slice(0, -2))).toThrow(RangeError)
    expect(() => parseSignedTransfer(`${vector.serialized}00`)).toThrow(RangeError)
    expect(() => parseSignedTransfer(`02${vector.serialized.slice(2)}`)).toThrow(RangeError)
  })
})

describe('addressBytes', () => {
  it('round-trips payment addresses and rejects bad checksums', () => {
    const hex = '0123456789abcdef0123456789abcdef01234567'
    const address = paymentAddress(hex)
    expect(Array.from(addressBytes(address), byte => byte.toString(16).padStart(2, '0')).join('')).toBe(hex)
    expect(() => addressBytes(address.replace(/^NQ\d\d/, 'NQ00'))).toThrow('checksum')
    expect(() => addressBytes('NQ1SENDER')).toThrow(RangeError)
  })
})
