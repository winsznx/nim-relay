# First real handoffs on Nimiq mainnet, 2026-09-18

Two iPhones running NIM Relay inside Nimiq Pay passed Starter Baton `8A06053762` (Global Relay #004) back and forth on MainAlbatross. Every pass was a native Nimiq Pay transfer of 1 NIM, verified by the Worker before custody moved.

| Leg | From | To | Transaction | Recorded |
|---|---|---|---|---|
| 1 | runner-204816 | runner-95d356 | `19c40cf4b221f4ae7c4dfdb9343ac088e4cc3e401986680a621e6c542443035b` | earlier the same day |
| 2 | runner-95d356 | runner-204816 | `fb2f99fcfb80ed3d9e5a6d3cc508914ea5316bb0688bc001cb787f6c9715861d` | in the demo video |
| 3 | runner-204816 | runner-95d356 | `44a4455cff9cd4f517860d90c5894efc66b71df2485e94a2b2da8602b1ba0c1d` | in the demo video |

To check each one independently:

```bash
pnpm verify:handoff --network mainnet --tx <hash>
```

For every leg, the script confirmed:

- executed on MainAlbatross
- value 100000 Luna (1 NIM)
- the `NR1.8A06053762.<leg>.<commitment>` data
- the recipient is the chosen runner's address
- the transaction is in the baton's canonical lineage at that leg
- one archived row in Supabase

The baton was created by a confirmed Relay Grants starter transfer from the mainnet treasury. That starter transfer is recorded as `treasury_starter_grant` and isn't counted as a handoff.

## What real phones found

Nimiq Pay sends NIM that arrives at a player's receiving address (the one they sign in with) on to an internal address within seconds, and pays from that internal address. None of the three verified transfers came from the sign-in address: the senders were `NQ22 UB81…`, `NQ59 QS4F…` and `NQ39 AQ51…`. The first mainnet attempts were therefore rejected as `SENDER_MISMATCH`. Commit `ad126af` stopped comparing the payer with the sign-in address. A pass now counts when the transfer carries the pass's server-issued commitment to the chosen runner, with the right value, network, execution and confirmations. The reasoning is in `SECURITY.md`.

Before that fix, three rejected 1 NIM transfers went to the chosen runners' wallets. They weren't lost, but they didn't count as handoffs.

## Recording

`final/NIM_Relay_Final_Demo_VO_Subtitled.mp4` shows legs 2 and 3 on both phones, with the status bar clocks. `final/edit-plan.json` records how the two screen recordings were synchronised.
