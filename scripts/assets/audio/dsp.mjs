/**
 * Analysis and editing for the audio asset build. Pure functions over planar Float32Array
 * channels; no I/O.
 */

export const dbToGain = db => 10 ** (db / 20)
export const gainToDb = gain => 20 * Math.log10(gain)

export function mixToMono(channels) {
  if (channels.length === 1) return channels[0]
  const mono = new Float32Array(channels[0].length)
  for (const channel of channels) {
    for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length
  }
  return mono
}

export function peak(channels) {
  let max = 0
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) max = Math.max(max, Math.abs(channel[i]))
  }
  return max
}

export function applyGain(channels, gain) {
  return channels.map(channel => channel.map(sample => sample * gain))
}

/** Wraps `value` into (-period / 2, period / 2]. */
export function wrapSigned(value, period) {
  const wrapped = ((value % period) + period) % period
  return wrapped > period / 2 ? wrapped - period : wrapped
}

// ---------------------------------------------------------------------------
// Onsets and beat grid
// ---------------------------------------------------------------------------

function hann(size) {
  return Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size))
}

/** Iterative radix-2 FFT, in place. */
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length
    const stepRe = Math.cos(angle)
    const stepIm = Math.sin(angle)
    for (let start = 0; start < n; start += length) {
      let wRe = 1
      let wIm = 0
      for (let k = 0; k < length / 2; k++) {
        const a = start + k
        const b = a + length / 2
        const vRe = re[b] * wRe - im[b] * wIm
        const vIm = re[b] * wIm + im[b] * wRe
        re[b] = re[a] - vRe
        im[b] = im[a] - vIm
        re[a] += vRe
        im[a] += vIm
        const nextRe = wRe * stepRe - wIm * stepIm
        wIm = wRe * stepIm + wIm * stepRe
        wRe = nextRe
      }
    }
  }
}

/**
 * Positive log-magnitude spectral flux, one value per hop. Frame `f` covers samples
 * [f * hop, f * hop + size). Broadband flux marks where a drum hit starts; low-band energy
 * rises 10-50 ms later depending on the kick, which is too loose for a beat grid.
 */
export function spectralFlux(mono, { size = 512, hop = 64 } = {}) {
  const frames = Math.max(0, Math.floor((mono.length - size) / hop) + 1)
  const window = hann(size)
  const flux = new Float32Array(frames)
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  let previous = new Float64Array(size / 2)
  let current = new Float64Array(size / 2)
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * hop
    for (let i = 0; i < size; i++) {
      re[i] = mono[offset + i] * window[i]
      im[i] = 0
    }
    fft(re, im)
    let rise = 0
    for (let bin = 1; bin < size / 2; bin++) {
      current[bin] = Math.log1p(100 * Math.hypot(re[bin], im[bin]))
      if (frame > 0 && current[bin] > previous[bin]) rise += current[bin] - previous[bin]
    }
    flux[frame] = rise
    ;[previous, current] = [current, previous]
  }
  return flux
}

/**
 * Comb-filters onsets against a beat grid of known `period` (samples). Returns the grid phase in
 * [0, period) with the most onset energy on its lines, and the contrast of that phase against
 * the mean of all phases (a confidence: ~1 means no beat, 2+ is a clear grid).
 */
export function beatPhase(mono, period, { size = 512, hop = 64, step = 4 } = {}) {
  const flux = spectralFlux(mono, { size, hop })
  const fluxAt = sample => {
    const position = (sample - size / 2) / hop
    const index = Math.floor(position)
    if (index < 0 || index + 1 >= flux.length) return 0
    const t = position - index
    return flux[index] * (1 - t) + flux[index + 1] * t
  }
  let best = { phase: 0, score: -Infinity }
  let total = 0
  let candidates = 0
  for (let phase = 0; phase < period; phase += step) {
    let score = 0
    for (let line = phase; line < mono.length; line += period) score += fluxAt(line)
    if (score > best.score) best = { phase, score }
    total += score
    candidates++
  }
  return { phase: best.phase, contrast: best.score / (total / candidates) }
}

/**
 * Systematic offset of `beatPhase` on ideal hits: a synthetic kick (a click and a decaying
 * 55 Hz body) placed exactly on a known grid. Subtracting it makes measured phases absolute.
 */
export function beatPhaseBias(period, sampleRate, options) {
  const beats = 48
  const truePhase = Math.round(period / 2)
  const hits = new Float32Array(Math.ceil(period * beats))
  let seed = 0x9e3779b9
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 31 - 1
  }
  for (let beat = 0; beat < beats - 1; beat++) {
    const start = Math.round(truePhase + beat * period)
    for (let i = 0; i < Math.round(0.2 * sampleRate); i++) {
      const t = i / sampleRate
      const click = i < 0.002 * sampleRate ? noise() * 0.6 : 0
      hits[start + i] += click + 0.8 * Math.sin(2 * Math.PI * 55 * t) * Math.exp(-t / 0.06)
    }
  }
  const { phase } = beatPhase(hits, period, options)
  return wrapSigned(phase - truePhase, period)
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/**
 * Cuts [start, start + length) as a seamless loop. The first `fade` samples are crossfaded with
 * the audio that follows the loop end, so wrapping from the last sample to the first continues
 * the source instead of jumping. The loop keeps its exact length.
 */
export function crossfadeLoop(channels, start, length, fade, curve = 'linear') {
  if (start < 0 || start + length + fade > channels[0].length) {
    throw new RangeError(`crossfadeLoop: [${start}, ${start + length + fade}) is outside the ${channels[0].length}-frame source`)
  }
  return channels.map(channel => {
    const loop = channel.slice(start, start + length)
    for (let i = 0; i < fade; i++) {
      const t = (i + 0.5) / fade
      const fadeIn = curve === 'equal-power' ? Math.sin((t * Math.PI) / 2) : t
      const fadeOut = curve === 'equal-power' ? Math.cos((t * Math.PI) / 2) : 1 - t
      loop[i] = channel[start + i] * fadeIn + channel[start + length + i] * fadeOut
    }
    return loop
  })
}

/**
 * How abrupt the wrap from the last sample to the first is, relative to the loop's own
 * sample-to-sample movement (99.9th percentile). Around 1 or below is inaudible.
 */
export function seamRoughness(channels) {
  let worst = 0
  for (const channel of channels) {
    const steps = new Float32Array(channel.length - 1)
    for (let i = 1; i < channel.length; i++) steps[i - 1] = Math.abs(channel[i] - channel[i - 1])
    steps.sort()
    const typical = steps[Math.floor(steps.length * 0.999)] || 1e-9
    worst = Math.max(worst, Math.abs(channel[0] - channel[channel.length - 1]) / typical)
  }
  return worst
}

/**
 * Removes leading and trailing silence from a one-shot. The head is cut just before the first
 * sample within `headDb` of the peak (keeping `preRoll` seconds, faded in), so a cue sounds on
 * the frame it is triggered; the tail keeps `tail` seconds after the last sample within `tailDb`.
 */
export function trimSilence(channels, sampleRate, { headDb = -40, tailDb = -60, preRoll = 0.001, tail = 0.03, fadeOut = 0.02 } = {}) {
  const frames = channels[0].length
  const envelope = new Float32Array(frames)
  for (const channel of channels) {
    for (let i = 0; i < frames; i++) envelope[i] = Math.max(envelope[i], Math.abs(channel[i]))
  }
  const top = envelope.reduce((max, value) => Math.max(max, value), 0)
  if (top === 0) throw new Error('trimSilence: the sound is silent')
  let first = 0
  while (first < frames && envelope[first] <= top * dbToGain(headDb)) first++
  let last = frames - 1
  while (last > first && envelope[last] <= top * dbToGain(tailDb)) last--

  const start = Math.max(0, first - Math.round(preRoll * sampleRate))
  const end = Math.min(frames, last + 1 + Math.round(tail * sampleRate))
  const fadeInFrames = first - start
  const fadeOutFrames = Math.min(end - start, Math.round(fadeOut * sampleRate))
  const trimmed = channels.map(channel => {
    const out = channel.slice(start, end)
    for (let i = 0; i < fadeInFrames; i++) out[i] *= i / fadeInFrames
    for (let i = 0; i < fadeOutFrames; i++) out[out.length - 1 - i] *= i / fadeOutFrames
    return out
  })
  return { channels: trimmed, headSeconds: start / sampleRate, tailSeconds: (frames - end) / sampleRate }
}

// ---------------------------------------------------------------------------
// Key
// ---------------------------------------------------------------------------

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
/** Krumhansl-Kessler key profiles. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function correlation(a, b) {
  const meanA = a.reduce((sum, v) => sum + v, 0) / a.length
  const meanB = b.reduce((sum, v) => sum + v, 0) / b.length
  let numerator = 0
  let varianceA = 0
  let varianceB = 0
  for (let i = 0; i < a.length; i++) {
    numerator += (a[i] - meanA) * (b[i] - meanB)
    varianceA += (a[i] - meanA) ** 2
    varianceB += (b[i] - meanB) ** 2
  }
  return numerator / Math.sqrt(varianceA * varianceB)
}

/**
 * Tonal centre from a whole-track chroma profile. Synthesized layers only ever use the tonic and
 * its fifth, which sit in both the major and minor reading, so the mode is informational.
 */
export function estimateKey(mono, sampleRate) {
  const size = 8192
  const window = hann(size)
  const chroma = new Float64Array(12)
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let offset = 0; offset + size <= mono.length; offset += size / 2) {
    for (let i = 0; i < size; i++) {
      re[i] = mono[offset + i] * window[i]
      im[i] = 0
    }
    fft(re, im)
    for (let bin = 1; bin < size / 2; bin++) {
      const hz = (bin * sampleRate) / size
      if (hz < 55 || hz > 2000) continue
      const pitchClass = (((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12)
      chroma[pitchClass] += Math.sqrt(Math.hypot(re[bin], im[bin]))
    }
  }
  const candidates = []
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = Array.from({ length: 12 }, (_, i) => chroma[(i + tonic) % 12])
    candidates.push({ tonic: PITCH_CLASSES[tonic], mode: 'major', score: correlation(rotated, MAJOR_PROFILE) })
    candidates.push({ tonic: PITCH_CLASSES[tonic], mode: 'minor', score: correlation(rotated, MINOR_PROFILE) })
  }
  candidates.sort((a, b) => b.score - a.score)
  const [best] = candidates
  const rival = candidates.find(candidate => candidate.tonic !== best.tonic)
  return { tonic: best.tonic, mode: best.mode, confidence: best.score, margin: best.score - rival.score }
}
