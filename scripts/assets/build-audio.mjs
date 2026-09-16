/**
 * Builds NIM Relay's shipped audio from CC0 sources staged on disk.
 *
 *   node scripts/assets/build-audio.mjs --staging <folder>
 *
 * The staging folder holds `manifest.json` (file, asset, source_url, author, license,
 * license_url per file) and the files it lists. The build refuses any source that is not CC0,
 * converts everything to AAC in .m4a (the format iOS WebViews decode natively), normalises
 * loudness, trims one-shots, turns music into sample-accurate loops (race music on the engine's
 * 144 BPM grid), then writes:
 *
 *   apps/web/public/assets/audio/{music,ambience,sfx}/*.m4a
 *   apps/web/src/features/audio/tracks.ts
 *   apps/web/public/assets/manifest.json (audio entries replaced, other assets kept)
 *
 * Needs ffmpeg and ffprobe on PATH (or FFMPEG / FFPROBE set).
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { decodePcm, decodedFrames, encodeAac, measureLoudness, writeWav } from './audio/ffmpeg.mjs'
import { applyGain, dbToGain, estimateKey, gainToDb, peak, seamRoughness, trimSilence } from './audio/dsp.mjs'
import { LOOP_BUILDERS } from './audio/loops.mjs'
import { BUDGET_BYTES, SAMPLE_RATE, SFX_PEAK_DB, SOUND_SPECS, TRACK_SPECS } from './audio/plan.mjs'
import { mergeManifest, writeTracksModule } from './audio/emit.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PUBLIC_ASSETS = join(ROOT, 'apps/web/public/assets')
const AUDIO_OUT = join(PUBLIC_ASSETS, 'audio')
const TRACKS_MODULE = join(ROOT, 'apps/web/src/features/audio/tracks.ts')
const GENERATOR = 'scripts/assets/build-audio.mjs'

const CC0_LICENSE = 'CC0 1.0'
const CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/'
/** Loops must wrap no more abruptly than their own busiest sample steps. */
const MAX_SEAM_ROUGHNESS = 1.5
const TONIC_CONFIDENCE = 0.6
const LOOP_PEAK_CEILING_DB = -1

const { values: args } = parseArgs({ options: { staging: { type: 'string' } } })
const staging = args.staging ?? process.env.NIM_RELAY_AUDIO_STAGING
if (!staging || !existsSync(join(staging, 'manifest.json'))) {
  console.error('Usage: node scripts/assets/build-audio.mjs --staging <folder containing manifest.json and audio/>')
  process.exit(1)
}

const stagingManifest = JSON.parse(readFileSync(join(staging, 'manifest.json'), 'utf8'))

/** Every source is checked before any processing starts, so a licence problem never ships half a build. */
function licensedSource(file) {
  const entry = stagingManifest.find(candidate => candidate.file === file)
  if (!entry) throw new Error(`${file}: not listed in the staging manifest`)
  if (entry.license !== CC0_LICENSE || entry.license_url !== CC0_URL) {
    throw new Error(`${file}: licence is "${entry.license}" (${entry.license_url}); only CC0 sources may ship`)
  }
  if (!existsSync(join(staging, file))) throw new Error(`${file}: listed in the staging manifest but missing on disk`)
  return entry
}

const CODEC_NAMES = { vorbis: 'Ogg Vorbis', mp3: 'MP3', pcm_s16le: '16-bit WAV', pcm_s24le: '24-bit WAV', pcm_f32le: '32-bit float WAV' }

/** "decoded from Ogg Vorbis 44100 Hz stereo, downmixed to mono", from the staging note "vorbis 44100Hz 2ch". */
function decodeNote(entry, outputChannels) {
  const match = /(\w+) (\d+)Hz (\d)ch/.exec(entry.notes ?? '')
  if (!match) return `decoded from ${entry.file.split('.').at(-1)}`
  const [, codec, rate, channels] = match
  const downmix = Number(channels) > outputChannels ? ', downmixed to mono' : ''
  return `decoded from ${CODEC_NAMES[codec] ?? codec} ${rate} Hz ${channels === '1' ? 'mono' : 'stereo'}${downmix}`
}

function manifestEntry(path, entry, modifications, bytes) {
  return {
    path,
    name: entry.asset,
    source: entry.source_url,
    sourceFile: entry.file.split('/').at(-1),
    author: entry.author,
    license: 'CC0-1.0',
    licenseUrl: entry.license_url,
    generator: GENERATOR,
    modifications,
    bytes,
  }
}

/** Encodes into the work folder, then proves the decoder sees exactly the frames that were written. */
function encodeVerified(work, id, channels, outPath, bitrate) {
  mkdirSync(dirname(outPath), { recursive: true })
  const wav = join(work, `${id}.wav`)
  writeWav(wav, channels, SAMPLE_RATE)
  encodeAac(wav, outPath, { bitrate })
  const decoded = decodedFrames(outPath, channels.length)
  if (decoded !== channels[0].length) {
    throw new Error(`${id}: encoded file decodes to ${decoded} frames, expected ${channels[0].length}`)
  }
  return statSync(outPath).size
}

function buildTrack(spec, work) {
  const entry = licensedSource(spec.source)
  const file = join(staging, spec.source)
  const loop = LOOP_BUILDERS[spec.loop.kind](spec, file)

  const roughness = seamRoughness(loop.channels)
  if (roughness > MAX_SEAM_ROUGHNESS) throw new Error(`${spec.id}: loop seam is too abrupt (roughness ${roughness.toFixed(2)})`)

  const probe = join(work, `${spec.id}.probe.wav`)
  writeWav(probe, loop.channels, SAMPLE_RATE)
  const { integrated } = measureLoudness(probe)
  const wantedDb = spec.lufs - integrated
  const ceilingDb = LOOP_PEAK_CEILING_DB - gainToDb(peak(loop.channels))
  const gainDb = Math.min(wantedDb, ceilingDb)
  const normalized = applyGain(loop.channels, dbToGain(gainDb))
  const loudness = integrated + gainDb

  const path = `audio/${spec.dir}/${spec.id}.m4a`
  const bytes = encodeVerified(work, spec.id, normalized, join(work, path), spec.bitrate)

  let tonic = null
  if (spec.role !== 'wind' && spec.role !== 'hover' && spec.role !== 'rail') {
    const key = estimateKey(decodePcm(file, { channels: 1, sampleRate: 11025 })[0], 11025)
    tonic = key.confidence >= TONIC_CONFIDENCE ? key.tonic : null
    loop.notes += `, key ${key.tonic} ${key.mode} (${key.confidence.toFixed(2)}, margin ${key.margin.toFixed(2)})`
  }

  const loopSeconds = normalized[0].length / SAMPLE_RATE
  const channelWord = spec.channels === 2 ? 'stereo' : 'mono'
  const modifications = [
    decodeNote(entry, spec.channels),
    ...loop.modifications,
    loudness < spec.lufs - 0.5
      ? `normalised to ${loudness.toFixed(1)} LUFS integrated (${gainDb.toFixed(1)} dB; target ${spec.lufs} LUFS held back by the -1 dBFS peak ceiling)`
      : `normalised to ${spec.lufs} LUFS integrated (${gainDb.toFixed(1)} dB)`,
    `encoded AAC-LC ${spec.bitrate}bps ${channelWord} ${SAMPLE_RATE} Hz in M4A`,
  ]
  console.log(`  ${spec.id.padEnd(22)} ${loopSeconds.toFixed(3).padStart(8)} s  ${(bytes / 1024).toFixed(0).padStart(5)} KB  ${loop.notes}; seam ${roughness.toFixed(2)}; ${loudness.toFixed(1)} LUFS`)

  return {
    meta: {
      id: spec.id,
      url: `/assets/${path}`,
      role: spec.role,
      bpm: loop.bpm === null ? null : Math.round(loop.bpm * 1000) / 1000,
      bars: loop.bars,
      loopSeconds,
      gain: spec.gain,
      tonic,
      worlds: spec.worlds,
      downbeatOffsetMs: loop.downbeatOffsetMs === null ? null : Math.round(loop.downbeatOffsetMs * 100) / 100,
      bytes,
    },
    manifest: manifestEntry(path, entry, modifications, bytes),
  }
}

function buildSound(spec, work) {
  const entry = licensedSource(spec.source)
  const channelCount = spec.channels ?? 1
  const decoded = decodePcm(join(staging, spec.source), { channels: channelCount, sampleRate: SAMPLE_RATE })
  const trimmed = trimSilence(decoded, SAMPLE_RATE)
  const gainDb = SFX_PEAK_DB - gainToDb(peak(trimmed.channels))
  const normalized = applyGain(trimmed.channels, dbToGain(gainDb))

  const path = `audio/sfx/${spec.id}.m4a`
  const bytes = encodeVerified(work, spec.id, normalized, join(work, path), spec.bitrate)
  const seconds = normalized[0].length / SAMPLE_RATE
  const modifications = [
    decodeNote(entry, channelCount),
    `trimmed ${(trimmed.headSeconds * 1000).toFixed(0)} ms of leading and ${(trimmed.tailSeconds * 1000).toFixed(0)} ms of trailing silence`,
    `peak-normalised to ${SFX_PEAK_DB} dBFS (${gainDb.toFixed(1)} dB)`,
    `encoded AAC-LC ${spec.bitrate}bps ${channelCount === 2 ? 'stereo' : 'mono'} ${SAMPLE_RATE} Hz in M4A`,
  ]
  console.log(`  ${spec.id.padEnd(22)} ${seconds.toFixed(3).padStart(8)} s  ${(bytes / 1024).toFixed(1).padStart(5)} KB  head -${(trimmed.headSeconds * 1000).toFixed(0)} ms`)

  return {
    meta: { id: spec.id, url: `/assets/${path}`, seconds: Math.round(seconds * 10000) / 10000, channels: channelCount, bytes },
    manifest: manifestEntry(path, entry, modifications, bytes),
  }
}

/** Replaces the shipped audio with the new build: copies every file in and deletes files the plan dropped. */
function publish(work, paths) {
  const expected = new Set(paths)
  for (const dir of ['music', 'ambience', 'sfx']) {
    const folder = join(AUDIO_OUT, dir)
    mkdirSync(folder, { recursive: true })
    for (const name of readdirSync(folder)) {
      const path = `audio/${dir}/${name}`
      if (name.endsWith('.m4a') && !expected.has(path)) {
        rmSync(join(PUBLIC_ASSETS, path))
        console.log(`  removed stale ${path}`)
      }
    }
  }
  for (const path of paths) copyFileSync(join(work, path), join(PUBLIC_ASSETS, path))
}

for (const spec of [...TRACK_SPECS, ...SOUND_SPECS]) licensedSource(spec.source)
const work = mkdtempSync(join(tmpdir(), 'nim-relay-audio-'))

try {
  console.log('Loops')
  const tracks = TRACK_SPECS.map(spec => buildTrack(spec, work))
  console.log('One-shots')
  const sounds = SOUND_SPECS.map(spec => buildSound(spec, work))
  const shipped = [...tracks, ...sounds]

  // Nothing under apps/ changes unless the whole build succeeded and fits the budget.
  const total = shipped.reduce((sum, item) => sum + item.manifest.bytes, 0)
  console.log(`Built ${shipped.length} files, ${(total / 1_000_000).toFixed(2)} MB (budget ${(BUDGET_BYTES / 1_000_000).toFixed(1)} MB)`)
  if (total > BUDGET_BYTES) throw new Error(`audio is ${total} bytes, over the ${BUDGET_BYTES}-byte budget`)

  publish(work, shipped.map(item => item.manifest.path))
  mkdirSync(dirname(TRACKS_MODULE), { recursive: true })
  writeTracksModule(TRACKS_MODULE, tracks.map(track => track.meta), sounds.map(sound => sound.meta))
  mergeManifest(join(PUBLIC_ASSETS, 'manifest.json'), shipped.map(item => item.manifest))
  console.log(`Wrote ${relative(ROOT, AUDIO_OUT)}, ${relative(ROOT, TRACKS_MODULE)} and the asset manifest`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
