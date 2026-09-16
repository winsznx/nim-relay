/**
 * Thin, synchronous wrappers around the ffmpeg CLI for the audio asset build.
 * Audio moves between ffmpeg and Node as planar Float32Array channels.
 */
import { spawnSync } from 'node:child_process'
import { endianness } from 'node:os'
import { writeFileSync } from 'node:fs'

/** Override with FFMPEG=/path/to/ffmpeg. */
export const FFMPEG = process.env.FFMPEG ?? 'ffmpeg'

const MAX_OUTPUT_BYTES = 2 ** 31 - 1

/** PCM crosses the process boundary as raw little-endian float bytes copied straight into typed arrays. */
function assertLittleEndian() {
  if (endianness() !== 'LE') throw new Error('The audio build moves raw f32le PCM and needs a little-endian host')
}

function run(args, label) {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-nostdin', ...args], { maxBuffer: MAX_OUTPUT_BYTES })
  if (result.error) throw new Error(`${label}: could not run ${FFMPEG}: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`${label}: ffmpeg exited with ${result.status}\n${result.stderr.toString().trim()}`)
  return result
}

/**
 * Decodes `file` to planar float channels at `sampleRate`.
 * `filter` is an ffmpeg audio filter chain; `loops` repeats the input that many extra times
 * before filtering, which gives time-stretch and resampling filters real audio on both sides
 * of a loop point instead of an edge.
 */
export function decodePcm(file, { channels, sampleRate, filter = null, loops = 0 }) {
  assertLittleEndian()
  const args = ['-loglevel', 'error', '-stream_loop', String(loops), '-i', file, '-vn']
  if (filter) args.push('-af', filter)
  args.push('-ac', String(channels), '-ar', String(sampleRate), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1')
  const { stdout } = run(args, `decode ${file}`)

  const frames = Math.floor(stdout.byteLength / (4 * channels))
  const interleaved = new Float32Array(frames * channels)
  new Uint8Array(interleaved.buffer).set(stdout.subarray(0, frames * channels * 4))
  const planar = Array.from({ length: channels }, () => new Float32Array(frames))
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) planar[channel][frame] = interleaved[frame * channels + channel]
  }
  return planar
}

/** Writes 32-bit float WAV, the lossless hand-off format between Node and the encoder. */
export function writeWav(path, channels, sampleRate) {
  assertLittleEndian()
  const frames = channels[0].length
  const blockAlign = channels.length * 4
  const dataBytes = frames * blockAlign
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(3, 20)
  buffer.writeUInt16LE(channels.length, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * blockAlign, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(32, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)
  const interleaved = new Float32Array(frames * channels.length)
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels.length; channel++) interleaved[frame * channels.length + channel] = channels[channel][frame]
  }
  buffer.set(new Uint8Array(interleaved.buffer), 44)
  writeFileSync(path, buffer)
}

/** EBU R128 integrated loudness (LUFS) and true peak (dBTP) of a file. */
export function measureLoudness(file) {
  const { stderr } = run(
    ['-loglevel', 'info', '-nostats', '-i', file, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'],
    `loudness ${file}`,
  )
  const summary = stderr.toString().split('Summary:').at(-1) ?? ''
  const integrated = Number(/I:\s+(-?[\d.]+|-inf) LUFS/.exec(summary)?.[1])
  const truePeak = Number(/Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary)?.[1])
  if (!Number.isFinite(integrated)) throw new Error(`loudness ${file}: no integrated loudness in ebur128 summary`)
  return { integrated, truePeak }
}

/**
 * AAC-LC in an MP4 (.m4a) container with ffmpeg's native encoder. Its edit list records the
 * encoder priming and end padding exactly, so WebKit (CoreAudio) and Chromium both decode the
 * original sample count; that is what keeps loop lengths sample-accurate after compression.
 * The AudioToolbox encoder (`aac_at`) writes an inexact edit list and must not be used here.
 */
export function encodeAac(wavPath, outPath, { bitrate }) {
  run(
    [
      '-loglevel', 'error', '-y', '-i', wavPath,
      '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
      '-c:a', 'aac', '-b:a', bitrate, '-movflags', '+faststart', outPath,
    ],
    `encode ${outPath}`,
  )
}

/** Decoded frame count of an encoded file, as a decoder that honours the edit list sees it. */
export function decodedFrames(file, channels) {
  const { stdout } = run(
    ['-loglevel', 'error', '-i', file, '-ac', String(channels), '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'],
    `count frames ${file}`,
  )
  return stdout.byteLength / (2 * channels)
}
