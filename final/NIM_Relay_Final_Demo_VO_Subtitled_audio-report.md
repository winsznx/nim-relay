# NIM Relay demo: narration mix report

Built by `python3 scripts/build-demo-video.py --scale 2 --vo`.

| Measure | Value |
|---|---|
| Voiceover file | `final/Nim Relay.m4a` |
| Voiceover duration, raw | 124.65 s |
| Removed (silent lead-in and pause trims, no words cut, no time-stretch) | 4.40 s |
| Voiceover duration, edited | 120.07 s |
| First word / last word in the final video | 0.63 s / 118.92 s |
| Final video duration | 120.45 s |
| Integrated loudness | -14.0 LUFS (target -14) |
| True peak | -2.1 dBTP (limit -1) |
| Loudness range | 2.9 LU |
| Sample peak | -2.2 dBFS |
| Clipping | none |

## Voice against music by section

Integrated loudness of each stem over the section, measured separately before the master gain.

| Section | Time | Voice | Music | Voice above music |
|---|---|---|---|---|
| Opening | 0.0-12.0 s | -16.4 LUFS | -33.1 LUFS | 16.8 dB |
| Nimiq Pay and handoff | 48.0-68.0 s | -16.3 LUFS | -32.8 LUFS | 16.5 dB |
| Return pass | 85.0-93.0 s | -17.1 LUFS | -33.0 LUFS | 16.0 dB |
| Proof | 102.0-111.0 s | -16.9 LUFS | -31.8 LUFS | 15.0 dB |
| Closing line | 111.0-120.5 s | -17.4 LUFS | -33.7 LUFS | 16.3 dB |

## Pause edits in the narration

| Removed from the raw voiceover | Length |
|---|---|
| 0.00-1.10 s | 1.10 s |
| 12.05-12.65 s | 0.60 s |
| 24.62-25.17 s | 0.55 s |
| 37.25-38.10 s | 0.85 s |
| 46.20-47.50 s | 1.30 s |
