# Phase 2 — Nimiq signed-message golden test vector

Generated with the real `@nimiq/core@2.21.0` Node.js build (offline tooling
only, per `DECISIONS.md` D-001 — never shipped in the deployed Worker) to
independently cross-check the pure-JS `packages/relay-protocol/src/nimiq-verify.ts`
implementation against the actual Nimiq crypto library, not just against a
re-reading of the Rust source it was derived from (`DECISIONS.md` D-002).

## Generation script

```js
const Nimiq = require('@nimiq/core')
const crypto = require('crypto')

const kp = Nimiq.KeyPair.generate()
const message = 'NIM Relay login\norigin: https://nim-relay.example\nnonce: test-nonce-123'
const messageBytes = Buffer.from(message, 'utf8')

const PREFIX = Buffer.concat([Buffer.from([0x16]), Buffer.from('Nimiq Signed Message:\n', 'utf8')])
const lenBytes = Buffer.from(String(messageBytes.length), 'utf8')
const toHash = Buffer.concat([PREFIX, lenBytes, messageBytes])
const hash = crypto.createHash('sha256').update(toHash).digest()

const sig = kp.sign(new Uint8Array(hash))

console.log(JSON.stringify({
  message,
  publicKeyHex: kp.publicKey.toHex(),
  addressUserFriendly: kp.publicKey.toAddress().toUserFriendlyAddress(),
  addressHex: Buffer.from(kp.publicKey.toAddress().serialize()).toString('hex'),
  hashHex: hash.toString('hex'),
  signatureHex: Buffer.from(sig.serialize()).toString('hex'),
}, null, 2))
```

Note: `KeyPair.sign()` in the JS bindings is the raw Ed25519 primitive (signs
exactly the bytes given, matching `key_pair.sign(hash.as_bytes())` in the
Rust source) - it does **not** apply the Nimiq message prefix/hash itself.
That construction is done by hand above, exactly matching
`wallet_account.rs::prepare_message_for_signature`.

## Generated vector

```json
{
  "message": "NIM Relay login\norigin: https://nim-relay.example\nnonce: test-nonce-123",
  "publicKeyHex": "af760135a20ffd2ba887e3b781f21282abb699d7391ca3516347890fe11bdec6",
  "addressUserFriendly": "NQ06 PKRY VS01 Q36J VFY7 5G32 JX11 09TA HDA3",
  "addressHex": "bcf3fee801c0cd2ebfe72c062978210276a8b543",
  "hashHex": "bfb8d939459dbbb0cd121640e53725714fd774ba9138250feee0f77b1a4deffd",
  "signatureHex": "7106f1c7567c3084bf82439094ff0eb29d73ed35fcdd893073d4520414535f5049ce96d0d3768894da13df574987025f4192be184ef500ea1cefcaa9b40d2503"
}
```

(Private key intentionally not recorded - not needed for verification and shouldn't be kept around even for a throwaway test keypair.)

## Cross-check result

Running `verifyNimiqSignedMessage()` and `deriveNimiqAddress()` from
`packages/relay-protocol/src/nimiq-verify.ts` against this vector:

```text
signature valid: true
derived address: bcf3fee801c0cd2ebfe72c062978210276a8b543
expected address: bcf3fee801c0cd2ebfe72c062978210276a8b543
address match: true
tampered message rejected: true
VECTOR_CHECK_PASS
```

This vector is now a permanent regression test:
`packages/relay-protocol/src/nimiq-verify.test.ts`.

## What this does and doesn't prove

Proves: our SHA-256(prefix + decimal-length + message) → Ed25519-verify
construction, and our Blake2b-256-truncated-to-20-bytes address derivation,
produce byte-identical results to the real Nimiq Rust crypto (compiled to
WASM, run via the Node.js binding) for a real generated keypair.

Does not yet prove: that a signature produced by the **Mini App SDK's**
`sign()` on a **real physical device** through Nimiq Pay follows this same
path end to end (SDK version differences, or a different signing code path
inside the wallet app, are possible in principle). That remains an open
item - see `run-state.json` "openVerificationItems" - to close with a real
device signature once physical-phone access is available.
