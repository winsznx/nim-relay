# Relay Grants

Relay Grants pay a new runner their first baton and a few small milestone grants from a dedicated NIM Relay treasury wallet. The Worker signs those transfers itself. Everything else about NIM Relay is unchanged: a runner's own passes still go through Nimiq Pay, approved by the runner, and the relay never holds a player's key.

Product language is RELAY GRANTS and STARTER BATON ("Your first relay is on us."). It is never called a faucet.

## Milestones and amounts

| Milestone | Default | Unlocks when |
|---|---:|---|
| `starter` | 1 NIM + fee | The linked wallet holds less than one baton (1 NIM) plus the fee, read from the chain at claim time |
| `first_handoff` | 1 NIM | The runner sent a qualified player-to-player handoff |
| `atlas_explorer` | 1 NIM | 3 distinct Atlas routes completed (`atlasProgressFor`) |
| `return_handoff` | 1 NIM | A qualified handoff on a later UTC day than the runner's first |
| `social` | 1 NIM | A runner they invited (claimed invite, another wallet, a grant record from another device) sent a qualified handoff, or their crew reached a 3-day best streak with at least one of their own crew handoffs |

Every milestone pays once. There are no per-transaction or repeatable rewards. Leg milestones such as 25, 50 and 100 handoffs earn artifacts and achievements (Atlas missions), never NIM.

A confirmed starter grant also creates a Starter Baton: a new Global baton held by the runner, on the first route out of Genesis Station (`starterRoute()`), with `starterGrant: { kind: 'treasury_starter_grant', at, toRunner, txHash, station: 'genesis' }` on the baton. It adds no handoff, so handoff counts, transacting wallets, relay metrics, Atlas statistics, ghosts, crews, rivals and proof metrics never include it. The proof page shows it separately, labelled `treasury_starter_grant`. When the runner races and passes it on, that pass is an ordinary qualified handoff and counts.

## Caps and configuration

All values are server-side. Defaults live in `apps/worker/src/station/network/grants/config.ts`; Worker variables may lower them.

| Variable | Default | Ceiling |
|---|---|---|
| `TREASURY_ENABLED` | off unless exactly `"true"` | |
| `TREASURY_PRIVATE_KEY` | Worker secret, hex Ed25519 key | |
| `TREASURY_TX_CAP_NIM` | 1.5 | 2, and never above the participant cap |
| `TREASURY_PARTICIPANT_CAP_NIM` | 5 (per wallet and per device) | 5 |
| `TREASURY_DAILY_CAP_NIM` | 25 per UTC day | the global cap |
| `TREASURY_GLOBAL_CAP_NIM` | 100 on mainnet, 500 on testnet | |
| `TREASURY_LOW_BALANCE_NIM` | 10 | |
| `GRANT_AMOUNTS_NIM` | `starter:1,first_handoff:1,atlas_explorer:1,return_handoff:1,social:1` | each amount plus fee within the transfer cap, all together within the participant cap |
| `GRANT_FEE_LUNA` | 0 (Albatross accepts zero-fee basic transfers) | 1000 |

A value that would raise a ceiling, or amounts that no longer fit, turn grants off with a reason in `/ops`. Nothing is clamped silently.

Operators (`OPS_PLAYERS`) have a runtime switch in `/ops` (`POST /api/station/network/grants/pause { paused }`). It takes effect for the next claim and the next rebroadcast. Transfers already on their way keep being verified.

## Provisioning

```sh
pnpm exec tsx scripts/treasury/provision.ts --network testnet   # writes the testnet Worker secret
pnpm exec tsx scripts/treasury/provision.ts --network mainnet   # writes the mainnet Worker secret
```

The script generates a key, pipes it into `wrangler secret put TREASURY_PRIVATE_KEY` over stdin and prints only the address. Fund that address with a small balance (a few days of the daily cap), set `TREASURY_ENABLED` to `"true"` for that Worker and redeploy. Keep the treasury a low-balance hot wallet: top it up, never park funds there. `--dry-run` shows an address without writing anything.

## API

| Route | Who | Body | Answer |
|---|---|---|---|
| `GET /api/station/network/grants` | signed in | | `GrantsView`: each milestone as locked, available, pending, confirmed or failed, claimed NIM and the cap |
| `POST /api/station/network/grants/claim` | signed in | `{ grantId }` only; unknown fields are rejected | `GrantClaimResult`, or a refusal code |
| `GET /api/station/network/grants/summary` | public | | Enabled or paused, grant and confirmation counts, NIM granted, coarse headroom, low-balance flag. No player addresses, no device data |
| `GET /api/station/network/grants/ops` | operators | | Caps, spend, transfer states, grants kept apart from handoffs, abuse log |
| `POST /api/station/network/grants/pause` | operators | `{ paused }` | The ops report |
| `POST /api/auth/device` | signed in | `{ deviceId }` | Links the HMAC of the Nimiq Pay device identifier to a session that has none |

The server derives the recipient (the session's linked wallet), the amount, eligibility and the idempotency key `grant:<milestone>:<playerId>`. Each grant is also charged to the device hash per milestone.

## Claim flow

All grant state lives in the `StationRoom` Durable Object under `network:<network>:grants`, on small keys: the ledger totals, one record per grant, one charge per wallet and one per device.

1. Critical section: if a grant for this runner and milestone already holds a reservation, return it (double clicks and concurrent claims get the same record). Otherwise count the attempt (20 per runner per UTC day) and check, in order: enabled, not paused, at most 5 attempts after failures, device signal present, wallet and device not already charged for this milestone by someone else, milestone requirement, participant cap for the wallet and for the device, daily cap, global cap.
2. Between critical sections: read the treasury balance, the chain height and, for starter, the wallet balance. Any failed read refuses the claim (`treasury_unavailable`, fail closed).
3. Critical section: re-run every check against stored state and the chain facts, then check the treasury balance minus all unconfirmed grants. Right before signing, assert the amount plus fee is within the per-transfer cap and ceiling. Sign the transfer (validity start height = the height just read, data `NIM Relay grant: <milestone>`) and, in one storage transaction, write the grant record as `prepared` with the signed bytes and hash, and charge the wallet, the device, the day and the global total.
4. Broadcast with `sendRawTransaction`. On success the record becomes `broadcast`; on failure it stays `prepared` and the alarm sends the same bytes again.
5. The alarm, every 15 seconds while grants are open, looks each grant up by hash: sender is the treasury, recipient, value, network, execution result and at least 2 confirmations, then `confirmed`. Unconfirmed grants are re-broadcast unchanged (same hash) at most every 30 seconds. A failed execution, or a chain past the validity window (7,200 blocks plus 120) whose treasury history reads back past the grant without the hash, marks it `failed` and releases every charge, so the runner can claim again. A hash that shows a different transfer is marked failed without releasing anything and goes to the abuse log.

A restart at any point resumes from the stored record: the alarm re-broadcasts the same signed bytes until the grant confirms or provably can no longer land.

## Threat model and limits

- Device signal. Nimiq Pay's `requestDeviceIdentifier` is shared with the runner's approval, sent to `/api/auth/verify` or `/api/auth/device`, and stored only as HMAC-SHA256 with `DEVICE_HASH_SECRET` on the session. Claims without it are refused with `no_device_signal`.
- Every grant is charged to both the wallet and the device hash. Exhausting either blocks further grants, and switching only the other does not reset anything. One starter per wallet and one per device.
- This is not Sybil resistance. The device identifier comes from the client, a reinstalled app or another phone looks like a new device, and many wallets on many devices can each claim. The caps bound the loss: at most 5 NIM per wallet and device, 25 NIM per day and the global cap. Milestones past starter need real, independently verified 1 NIM handoffs between wallets.
- The starter check that a wallet is "already funded" reads the balance of the address the player signed in with. Nimiq Pay moves incoming NIM from that address into an internal address within seconds (seen on mainnet, 2026-09-18), so for Nimiq Pay players it almost always reads zero. In practice every new wallet and device can claim one starter grant; the per-wallet, per-device, daily and global caps are what bound it.
- Social referrals only count an invited runner whose grant records carry a different device hash, so a runner can't refer their own second wallet on the same phone.
- Controlled and operator wallets (`OPS_PLAYERS`) are counted apart from player grants in the summary and in `/ops`.
- The treasury key is a Worker secret. It is never in source, storage, Supabase, logs, errors or responses; signing failures surface as `treasury_unavailable`. Tests check responses, logs and stored grant state for the key.
- A leaked key can spend at most the treasury balance, which is why the treasury stays small and the key can be rotated by re-running the provisioning script.
- No deposits are accepted and no client-chosen amount or recipient is ever read.

## Signing without @nimiq/core

`packages/relay-protocol/src/nimiq-transaction.ts` builds, signs, serializes and hashes basic transfers with `@noble/ed25519` and `@noble/hashes`. Tests pin byte-identical serialization, hashes and signatures against vectors produced by `@nimiq/core` 2.21.0 (`scripts/treasury/transaction-vectors.mjs` regenerates them). A real TestAlbatross transfer signed this way and broadcast through `https://rpc.testnet.nimiqwatch.com/` confirmed as `ee6ac0519f87784923d64148940816612011da83eb779a268c819be26f3d3c01`.
