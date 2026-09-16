/**
 * Builds seamless, exactly-sized loops from staged sources. Every builder returns planar
 * channels at SAMPLE_RATE plus what it measured and changed, for tracks.ts and the manifest.
 */
import { spawnSync } from 'node:child_process'
import { decodePcm } from './ffmpeg.mjs'
import { beatPhase, beatPhaseBias, crossfadeLoop, mixToMono, peak, dbToGain, wrapSigned } from './dsp.mjs'
import { SAMPLE_RATE } from './plan.mjs'

/** Onset-grid confidence below which a measured downbeat is not trusted. */
const MIN_BEAT_CONTRAST = 1.5
/** A source's length may miss its nominal whole-bar length by this much (codec padding). */
const WHOLE_BAR_TOLERANCE_SECONDS = 0.005
const MUSIC_SEAM_FADE_SECONDS = 0.01

function nativeSampleRate(file) {
  const ffprobe = process.env.FFPROBE ?? 'ffprobe'
  const result = spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', file])
  const rate = Number(result.stdout?.toString().trim())
  if (result.status !== 0 || !Number.isInteger(rate) || rate <= 0) throw new Error(`${file}: could not read the sample rate with ${ffprobe}`)
  return rate
}

/** Source length in output frames, from a decode at the native rate (container durations are not trusted). */
function sourceFrames(file, channels) {
  const rate = nativeSampleRate(file)
  const native = decodePcm(file, { channels, sampleRate: rate })[0].length
  return { frames: Math.round((native * SAMPLE_RATE) / rate), rate }
}

function assertWholeBars(label, frames, bpm, bars) {
  const expected = (bars * 4 * 60 * SAMPLE_RATE) / bpm
  const missSeconds = Math.abs(frames - expected) / SAMPLE_RATE
  if (missSeconds > WHOLE_BAR_TOLERANCE_SECONDS) {
    throw new Error(`${label}: ${frames} frames is not ${bars} bars at ${bpm} BPM (off by ${(missSeconds * 1000).toFixed(1)} ms)`)
  }
}

/** Offset (frames) from a nominal beat line in `mono` to the measured beat grid. */
function measureGrid(label, mono, period) {
  const { phase, contrast } = beatPhase(mono, period)
  if (contrast < MIN_BEAT_CONTRAST) throw new Error(`${label}: no clear beat grid (contrast ${contrast.toFixed(2)})`)
  return { offset: wrapSigned(phase - beatPhaseBias(period, SAMPLE_RATE), period), contrast }
}

/**
 * A whole-bar loop that starts on its downbeat, time-stretched to `bpm` with atempo. atempo is
 * accurate over the long run but shifts its output by a constant ~10 ms (either way) with a few
 * milliseconds of jitter, so the downbeat is measured on the stretched audio. The source is fed
 * three times and the loop is cut from the middle copy, which keeps atempo's start-up transient
 * away from the loop and leaves real stretched audio after the loop end for the seam crossfade.
 */
export function stretchedLoop(spec, file) {
  const { sourceBpm, bpm, bars } = spec.loop
  const { frames } = sourceFrames(file, spec.channels)
  assertWholeBars(spec.id, frames, sourceBpm, bars)

  const period = (60 * SAMPLE_RATE) / bpm
  if (!Number.isInteger(period)) throw new Error(`${spec.id}: ${bpm} BPM is not a whole number of frames per beat`)
  const barFrames = 4 * period
  const loopFrames = bars * barFrames
  const stretched = decodePcm(file, { channels: spec.channels, sampleRate: SAMPLE_RATE, filter: `atempo=${bpm}/${sourceBpm}`, loops: 2 })

  const nominalStart = loopFrames
  const region = mixToMono(stretched).subarray(nominalStart - barFrames, nominalStart + loopFrames + barFrames)
  const { offset, contrast } = measureGrid(spec.id, region, period)
  const start = nominalStart + Math.round(offset)
  const fade = Math.round(MUSIC_SEAM_FADE_SECONDS * SAMPLE_RATE)
  const downbeatOffsetMs = (Math.round(offset) / SAMPLE_RATE) * 1000

  return {
    channels: crossfadeLoop(stretched, start, loopFrames, fade),
    bpm,
    bars,
    downbeatOffsetMs,
    notes: `beat contrast ${contrast.toFixed(2)}, downbeat ${downbeatOffsetMs.toFixed(1)} ms from nominal`,
    modifications: [
      `time-stretched from ${sourceBpm} to ${bpm} BPM with ffmpeg atempo=${bpm}/${sourceBpm} (pitch preserved)`,
      `re-aligned to the measured downbeat (${downbeatOffsetMs.toFixed(1)} ms after stretching) so beat 0 is at 0 s`,
      `cut to ${bars} bars (${(loopFrames / SAMPLE_RATE).toFixed(3)} s) with a ${MUSIC_SEAM_FADE_SECONDS * 1000} ms loop-seam crossfade`,
    ],
  }
}

/** A source that already loops end to start. Decoded three times so resampling has no edges. */
export function wholeLoop(spec, file) {
  const { frames, rate } = sourceFrames(file, spec.channels)
  if (spec.loop.bpm) assertWholeBars(spec.id, frames, spec.loop.bpm, spec.loop.bars)
  const tripled = decodePcm(file, { channels: spec.channels, sampleRate: SAMPLE_RATE, loops: 2 })
  const fade = Math.round(MUSIC_SEAM_FADE_SECONDS * SAMPLE_RATE)
  const modifications = ['kept whole as an end-to-start loop']
  if (rate !== SAMPLE_RATE) modifications.unshift(`resampled from ${rate} Hz to ${SAMPLE_RATE} Hz`)
  return {
    channels: crossfadeLoop(tripled, frames, frames, fade, spec.loop.bpm ? 'linear' : 'equal-power'),
    bpm: spec.loop.bpm ?? null,
    bars: spec.loop.bars ?? null,
    downbeatOffsetMs: null,
    notes: `${frames} frames`,
    modifications,
  }
}

/** `bars` from inside the source on its measured beat grid, crossfaded into the audio that follows. */
export function cutLoop(spec, file) {
  const { bpm, bars, startBeat } = spec.loop
  const source = decodePcm(file, { channels: spec.channels, sampleRate: SAMPLE_RATE })
  const mono = mixToMono(source)
  const period = (60 * SAMPLE_RATE) / bpm
  const loopFrames = Math.round(bars * 4 * period)

  const floor = peak([mono]) * dbToGain(-60)
  let contentStart = 0
  while (contentStart < mono.length && Math.abs(mono[contentStart]) <= floor) contentStart++
  const { offset, contrast } = measureGrid(spec.id, mono, period)
  const target = contentStart + startBeat * period
  const start = Math.round(offset + Math.round((target - offset) / period) * period)
  const fade = Math.round(0.03 * SAMPLE_RATE)

  return {
    channels: crossfadeLoop(source, start, loopFrames, fade),
    bpm,
    bars,
    downbeatOffsetMs: null,
    notes: `beat contrast ${contrast.toFixed(2)}, content starts at ${(contentStart / SAMPLE_RATE * 1000).toFixed(1)} ms, loop starts at ${(start / SAMPLE_RATE).toFixed(3)} s`,
    modifications: [
      `skipped ${(contentStart / SAMPLE_RATE * 1000).toFixed(0)} ms of leading encoder silence`,
      `cut ${bars} bars at ${bpm} BPM (${(loopFrames / SAMPLE_RATE).toFixed(3)} s) on the measured beat grid from ${(start / SAMPLE_RATE).toFixed(3)} s`,
      'loop seam crossfaded (30 ms) into the audio that follows the cut',
    ],
  }
}

/** A fixed window of an unmetered texture, crossfaded (equal power) into the audio after it. */
export function segmentLoop(spec, file) {
  const { start, seconds, fade } = spec.loop
  const source = decodePcm(file, { channels: spec.channels, sampleRate: SAMPLE_RATE })
  const startFrame = Math.round(start * SAMPLE_RATE)
  const loopFrames = Math.round(seconds * SAMPLE_RATE)
  return {
    channels: crossfadeLoop(source, startFrame, loopFrames, Math.round(fade * SAMPLE_RATE), 'equal-power'),
    bpm: null,
    bars: null,
    downbeatOffsetMs: null,
    notes: `${seconds} s window from ${start} s`,
    modifications: [`cut a ${seconds} s window from ${start} s`, `loop seam crossfaded (${fade * 1000} ms, equal power)`],
  }
}

export const LOOP_BUILDERS = { stretch: stretchedLoop, whole: wholeLoop, cut: cutLoop, segment: segmentLoop }
