# Design — Visual System Authority

Derived from `nim_relay_8_screen_moodboard.png` (supplied reference, 8 screens) cross-checked against PRD §22-23. This is the visual-system authority for Phase 8 polish and every UI decision before it — no NIM-Relay-specific `DESIGN.md` existed prior to this file, so it is written directly from the moodboard rather than inherited from another project.

## Read from the moodboard

- **Background**: near-black deep midnight navy (`#0a0e1a`-ish), never pure black — subtle starfield/particle texture, never flat.
- **Hero object**: the baton renders as a luminous gold/amber hexagon with a comet trail — the single recognizable hero object referenced everywhere (icon, loading state, map marker, transitions).
- **Primary accent — NIM gold**: warm amber/gold gradient (`#f5a623`→`#e8890a`-ish), used for primary CTAs, the baton, active/highlighted stats, streak/combo numbers.
- **Secondary accent — electric cyan**: reserved for "live"/"verified"/system states specifically (verified checkmarks, live-relay pulse dot, the stabilize-challenge outer ring) — never used decoratively, matching PRD §23.1's "restrained electric cyan for live/system states."
- **Cards**: dark glass panels, soft rounded corners, thin 1px low-opacity borders, subtle inner glow on active/selected state — legibility preserved, never over-blurred.
- **Typography**: large, high-contrast, confident sans-serif headlines ("Live world relay", "Your turn is live.") pairing a neutral weight with a gold/white split-color treatment on the key word. Numbers (stats, countdowns, scores) get a slightly heavier/tabular treatment for scannability.
- **Map**: original stylized world projection (not a third-party map SDK), glowing dotted route lines between city markers, small labeled city pins with local time, comet-style animated baton position.
- **Avatars**: circular, thin gold ring on active/current holder, small flag badge overlay for country context (never claimed as blockchain-verified — see `PRIVACY.md`).
- **Status pills**: small rounded pill badges ("Wallet connected", "Live relay", "Pass approved!") — dot + label, cyan or gold dot depending on state.
- **Game HUD (Stabilize screen)**: full-bleed circular gauge, gold arc for progress, cyan for the "perfect zone" target band, large central "TAP & HOLD" affordance, stat tiles (Progress/Combo/Streak) pinned above the canvas, never overlapping the safe-area.
- **Bottom nav**: 5 icons, active item gold-highlighted with a filled pill background, matches PRD §20.2 (Home/Live/Rankings-adjacent/Profile — exact final 5 confirmed against PRD §20.2: Home, Inbox, Live, Rankings, Profile).
- **Achievement badges**: hexagonal badge shape (echoing the baton), gold outline, icon centered.
- **Motion cues implied by the moodboard**: comet-trail launch on pass, pulsing "live" dot, radial progress fill on the stabilize gauge, confetti/particle burst on relay-complete.

## Explicit avoid-list (PRD §23.2, confirmed absent from the moodboard)

No token price widgets, no giant raw wallet-address cards, no fake terminal UI, no cyberpunk neon outside the two defined accents, no cluttered analytics grids, no repeated wallet-connect prompts once a session exists.

## Design tokens (initial pass — refined with real Tailwind config in Phase 1/8)

```text
--color-bg-void:      #0a0e1a
--color-bg-panel:     rgba(255,255,255,0.04)   /* glass panel fill */
--color-border-panel: rgba(255,255,255,0.08)
--color-gold-500:     #f5a623
--color-gold-600:     #e8890a
--color-cyan-400:     #22d3ee                  /* live/verified only */
--color-text-primary: #f5f7fa
--color-text-muted:   #8b93a7
--font-display:       Inter (variable), fallback: -apple-system, sans-serif
--font-tabular:       Inter (tabular-nums) for all numeric stats/scores/countdowns
--radius-panel:       20px
--radius-pill:        999px
```

These are a first read of the moodboard, not a final locked palette — Phase 8 will extract exact hex values from the source PNG at full resolution and produce a real `apps/web/src/styles/tokens.css` from them, with this file updated to match exactly (never left to drift, per the phase-completion contract in the PRD).

## Status
Authority for Phase 1-7 component work (enough to build correct, on-brand UI as each surface lands) and the explicit brief for the dedicated Phase 8 polish pass.
