/**
 * What ships, from which staged source, and how it is processed. `source` is a path inside the
 * staging folder and must match a `file` entry of its manifest.json with a CC0 licence.
 *
 * Loop kinds:
 * - stretch: a source that is an exact whole-bar loop starting on its downbeat, time-stretched
 *   (pitch preserved) to `bpm`, re-aligned to its measured downbeat and cut to `bars`.
 * - whole: the source already loops end to start; only resampled and normalised.
 * - cut: `bars` cut from inside the source on its beat grid, starting near `startBeat`, for
 *   sources whose file boundaries are not usable loop points (for example MP3 encoder delay).
 * - segment: a fixed window of an unmetered texture, crossfaded into itself.
 */

export const SAMPLE_RATE = 44100

/** The race engine's pulse grid: 25 ticks per beat at 60 Hz. */
export const RACE_BPM = 144

export const MUSIC_LUFS = -16
export const AMBIENCE_LUFS = -20
export const SFX_PEAK_DB = -1

/** Everything under apps/web/public/assets/audio together. */
export const BUDGET_BYTES = 6_500_000

export const TRACK_SPECS = [
  {
    id: 'race-neon',
    dir: 'music',
    role: 'race',
    source: 'audio/music/mintodog__neon-sign-circuit__bpm145.ogg',
    loop: { kind: 'stretch', sourceBpm: 145, bpm: RACE_BPM, bars: 60 },
    worlds: ['metro', 'solar'],
    channels: 2,
    bitrate: '128k',
    lufs: MUSIC_LUFS,
    gain: 0.8,
  },
  {
    id: 'race-highway',
    dir: 'music',
    role: 'race',
    source: 'audio/music/mintodog__cool-highway__bpm140.ogg',
    loop: { kind: 'stretch', sourceBpm: 140, bpm: RACE_BPM, bars: 52 },
    worlds: ['coast', 'alpine', 'ocean'],
    channels: 2,
    bitrate: '128k',
    lufs: MUSIC_LUFS,
    gain: 0.8,
  },
  {
    id: 'world-space-city',
    dir: 'music',
    role: 'world',
    source: 'audio/music/mintodog__space-city__bpm115.ogg',
    loop: { kind: 'whole', bpm: 115, bars: 56 },
    worlds: [],
    channels: 2,
    bitrate: '128k',
    lufs: MUSIC_LUFS,
    gain: 0.5,
  },
  {
    id: 'station-mirrorshade',
    dir: 'music',
    role: 'station',
    source: 'audio/music/cinameng__mirrorshade-1.mp3',
    loop: { kind: 'cut', bpm: 107, bars: 4, startBeat: 4 },
    worlds: [],
    channels: 2,
    bitrate: '128k',
    lufs: MUSIC_LUFS,
    gain: 0.55,
  },
  {
    id: 'ceremony-mirrorshade',
    dir: 'music',
    role: 'ceremony',
    source: 'audio/music/cinameng__mirrorshade-2.mp3',
    loop: { kind: 'cut', bpm: 107, bars: 4, startBeat: 4 },
    worlds: [],
    channels: 2,
    bitrate: '128k',
    lufs: MUSIC_LUFS,
    gain: 0.6,
  },
  {
    id: 'wind',
    dir: 'ambience',
    role: 'wind',
    source: 'audio/sfx/loops/oga-sketchman3__wind-whoosh-loop.ogg',
    loop: { kind: 'whole' },
    worlds: [],
    channels: 1,
    bitrate: '96k',
    lufs: AMBIENCE_LUFS,
    gain: 0.9,
  },
  {
    id: 'hover',
    dir: 'ambience',
    role: 'hover',
    source: 'audio/sfx/loops/kenney-scifi__engineCircular_002.ogg',
    loop: { kind: 'segment', start: 0.5, seconds: 4, fade: 0.25 },
    worlds: [],
    channels: 1,
    bitrate: '96k',
    lufs: AMBIENCE_LUFS,
    gain: 0.35,
  },
  {
    id: 'rail',
    dir: 'ambience',
    role: 'rail',
    source: 'audio/sfx/loops/oga-zeroisnotnull__energy-emission-loop.ogg',
    loop: { kind: 'whole' },
    worlds: [],
    channels: 1,
    bitrate: '96k',
    lufs: AMBIENCE_LUFS,
    gain: 0.6,
  },
]

/** One-shots. Tonal sounds get 96 kbps; clicks, noise and impacts hold up at 64 kbps. */
export const SOUND_SPECS = [
  { id: 'gate-perfect', source: 'audio/sfx/pickup/kenney-digital__pepSound3.ogg', bitrate: '96k' },
  { id: 'gate-miss', source: 'audio/sfx/pickup/kenney-digital__pepSound1.ogg', bitrate: '96k' },
  { id: 'pulse-hit', source: 'audio/sfx/stingers/kenney-jingles__jingles_HIT13.ogg', bitrate: '96k' },
  { id: 'near-miss-a', source: 'audio/sfx/movement/oga-artisticdude__swish-5.wav', bitrate: '64k' },
  { id: 'near-miss-b', source: 'audio/sfx/movement/oga-artisticdude__swish-9.wav', bitrate: '64k' },
  { id: 'hit-a', source: 'audio/sfx/impact/kenney-impact__impactPunch_heavy_000.ogg', bitrate: '64k' },
  { id: 'hit-b', source: 'audio/sfx/impact/kenney-impact__impactPunch_heavy_003.ogg', bitrate: '64k' },
  { id: 'jump', source: 'audio/sfx/movement/oga-qubodup__swosh_22.wav', bitrate: '64k' },
  { id: 'land', source: 'audio/sfx/impact/kenney-impact__impactSoft_heavy_003.ogg', bitrate: '64k' },
  { id: 'clean-land', source: 'audio/sfx/ui/kenney-interface__confirmation_001.ogg', bitrate: '96k' },
  { id: 'slide', source: 'audio/sfx/movement/oga-qubodup__qubodup-megaswosh2.wav', bitrate: '64k' },
  { id: 'rail-on', source: 'audio/sfx/impact/kenney-impact__impactMetal_heavy_000.ogg', bitrate: '64k' },
  { id: 'rail-off', source: 'audio/sfx/movement/oga-artisticdude__swish-2.wav', bitrate: '64k' },
  { id: 'boost', source: 'audio/sfx/boost/oga-ezduzziteh__boost.mp3', bitrate: '64k' },
  { id: 'fork-safe', source: 'audio/sfx/pickup/kenney-digital__twoTone1.ogg', bitrate: '96k' },
  { id: 'fork-risk', source: 'audio/sfx/boost/kenney-digital__phaserUp3.ogg', bitrate: '96k' },
  { id: 'risk-clear', source: 'audio/sfx/pickup/kenney-digital__zapThreeToneUp.ogg', bitrate: '96k' },
  { id: 'fall-whoosh', source: 'audio/sfx/movement/oga-qubodup__qubodup-slomo1.wav', bitrate: '64k' },
  { id: 'fall-boom', source: 'audio/sfx/impact/kenney-scifi__lowFrequency_explosion_001.ogg', bitrate: '64k' },
  { id: 'flow-max', source: 'audio/sfx/boost/kenney-digital__phaserUp7.ogg', bitrate: '96k' },
  { id: 'finish', source: 'audio/sfx/stingers/kenney-jingles__jingles_HIT11.ogg', bitrate: '96k' },
  { id: 'overtake', source: 'audio/sfx/boost/kenney-digital__phaserUp2.ogg', bitrate: '96k' },
  { id: 'overtaken', source: 'audio/sfx/boost/kenney-digital__phaserDown3.ogg', bitrate: '96k' },
  { id: 'approach', source: 'audio/sfx/pickup/kenney-digital__twoTone2.ogg', bitrate: '96k' },
  { id: 'finish-win', source: 'audio/sfx/stingers/oga-zanelittlemusic__hyper-ultra-fanfare.wav', bitrate: '128k', channels: 2 },
  { id: 'finish-lose', source: 'audio/sfx/stingers/kenney-jingles__jingles_STEEL06.ogg', bitrate: '96k' },
  { id: 'ui-tap', source: 'audio/sfx/ui/kenney-interface__select_002.ogg', bitrate: '64k' },
  { id: 'ui-back', source: 'audio/sfx/ui/kenney-interface__back_002.ogg', bitrate: '64k' },
  { id: 'ui-error', source: 'audio/sfx/ui/kenney-interface__error_006.ogg', bitrate: '64k' },
  { id: 'wallet-open', source: 'audio/sfx/ui/kenney-interface__maximize_001.ogg', bitrate: '96k' },
  { id: 'wallet-paused', source: 'audio/sfx/ui/kenney-interface__minimize_001.ogg', bitrate: '96k' },
  { id: 'handoff-in-flight', source: 'audio/sfx/boost/kenney-scifi__forceField_000.ogg', bitrate: '96k' },
  { id: 'handoff-confirmed', source: 'audio/sfx/ui/kenney-interface__confirmation_004.ogg', bitrate: '96k' },
  { id: 'arrival', source: 'audio/sfx/pickup/kenney-interface__glass_004.ogg', bitrate: '96k' },
  { id: 'incoming', source: 'audio/sfx/pickup/kenney-digital__threeTone1.ogg', bitrate: '96k' },
  { id: 'catch', source: 'audio/sfx/pickup/kenney-interface__pluck_002.ogg', bitrate: '96k' },
  { id: 'launch-whoosh', source: 'audio/sfx/movement/oga-qubodup__qubodup-megaswosh1.wav', bitrate: '64k' },
]
