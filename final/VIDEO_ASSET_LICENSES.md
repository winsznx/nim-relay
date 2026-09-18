# Demo video assets

Everything in `NIM_Relay_Final_Demo.mp4` is original project material, CC0 music the app already ships, or macOS system fonts used to render captions.

## Footage

Two iPhone screen recordings of NIM Relay on Nimiq mainnet, made by the project author on 2026-09-18:

- Phone A (runner-95d356): `RPReplay_Final1789751069.MP4`
- Phone B (runner-204816): `RPReplay_Final1789751069 2.MP4`

The recordings' own audio isn't used.

## Music

These are the same tracks NIM Relay plays in the app. They're listed in `apps/web/public/assets/manifest.json`.

| Use in video | Track | Author | Source | License |
|---|---|---|---|---|
| World, journey, ending | Space City | MintoDog | https://opengameart.org/content/space-city | CC0-1.0 |
| Relay legs | Neon sign Circuit | MintoDog | https://opengameart.org/content/neon-sign-circuit | CC0-1.0 |
| Route choice and handoffs | Mirrorshade | cinameng | https://opengameart.org/content/mirrorshade | CC0-1.0 |

CC0-1.0: https://creativecommons.org/publicdomain/zero/1.0/

## Graphics and type

- The background, phone frames, labels, the arrow between phones and the proof card are drawn by `scripts/build-demo-video.py` and aren't product screens.
- Captions use Avenir Next, SF Pro and SF Mono, which are macOS system fonts, and are rendered into the video.
- The proof card lists the three Starter Baton 8A06053762 handoff transactions exactly as `pnpm verify:handoff --network mainnet` reported them after recording.
