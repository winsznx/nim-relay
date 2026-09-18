# NIM Relay competition submission

Submitted to Cycle II on 2026-09-18: https://github.com/nimiq/miniappscompetition-submissions/pull/240 (all validation checks passed).

Paste these into the Mini Apps Competition portal. Limits come from the submissions repo validator (`scripts/lib/schema.mjs`).

| Field | Value |
|---|---|
| app_name (max 80) | NIM Relay |
| category | Games |
| pricing | Free |
| repo_url | https://github.com/winsznx/nim-relay (public, MIT; push `production-relay` first) |
| demo_url | https://nimrelay.xyz |
| video_url | https://youtu.be/6orRlOB75ww (4K, captions from `final/NIM_Relay_Final_Demo_VO_Subtitled.srt`) |
| contact_email | entered in the portal, not published here |
| x_account | winsznx |
| icon | `final/screenshots/app-icon-512.png` (512 x 512) |
| thumbnail | `final/screenshots/thumbnail-240.png` (240 x 240, the size the portal asks for) |
| screenshots | `final/screenshots/`, in order: `1-relay-world.jpg` (the social preview), `2-the-game.png`, `3-the-handoff.png`, `4-the-journey.png`, `5-runner-profile.png`; all under 2 MB |

## tagline (max 120)

Receive a real NIM baton, race the last runner's verified ghost, and pass it on with Nimiq Pay.

(95 characters)

## description (max 280)

A living relay game where 1 real NIM travels hand to hand. Catch the baton, race the ghost of the person who passed it to you, then throw it to the next runner with Nimiq Pay. Every handoff is verified on chain and every race is replayed by the server.

(252 characters)

## builder_story (max 4000)

I wanted a game where the payment is the best moment, not a checkout screen after the fun.

NIM Relay treats a fixed amount of NIM as a baton. You receive it from a real person, carry it through a short high speed leg while racing their recorded ghost, and pass it to someone else. The pass is a normal Nimiq transfer. The game waits for the chain to confirm it before the baton changes hands, and then the next runner races your ghost. The world view is the history of those transfers.

The hard part was trust. A race score that the phone reports can be faked, so every leg runs on a deterministic fixed step simulation written in integer math. The phone records only inputs. The Cloudflare Worker replays them and computes the result itself. The same 200 recorded legs produce byte identical hashes in Node and in the Workers runtime, so a replay can't drift between the device and the server.

The handoff has the same rule. Before Nimiq Pay opens, the server locks the recipient, the amount and a short commitment that goes into the transaction data. After you approve, it looks the transaction up over JSON-RPC and checks recipient, value, commitment, network, execution and confirmations before custody moves. If the wallet reports a decline, the pass pauses and the baton stays with you. If the wallet result is unclear, the app asks you to check your wallet activity instead of sending twice.

One bug is worth sharing. My RPC client stored `fetch` on the instance and called it as a method. Unit tests stubbed the lookup, so everything passed. In the Workers runtime that call throws "Illegal invocation", so no real handoff could ever verify. A browser test with two mocked wallets and a mock chain RPC against a local Worker caught it. Now that test runs the whole relay, including declines, low balance, slow confirmations and a transfer to the wrong wallet.

What worked: making the race truthful first, then making it look good. What I would tell myself earlier: test the payment path in the real runtime from day one, not only in unit tests.

NIM is fungible, so the baton is an ordered chain of verified transfers of the same value, not a unique coin. The app says so on its proof page, and it separates testnet activity from mainnet usage.

(about 2,300 characters)

## Before submitting

1. Done: `main` on GitHub shows the current code.
2. Done: three real two-wallet handoffs verified on mainnet (`evidence/production/first-mainnet-handoffs-2026-09-18.md`).
3. Done: demo video recorded on two phones in Nimiq Pay and edited with narration (`final/`).
4. Done: five screenshots in `final/screenshots/`.
5. Done: X and Skool posts linked in the submission.
