import { describe, expect, it } from 'vitest'
import { BAR_SECONDS } from './grid'
import { SYNTH_SOUNDS, isSynthSound, pitchHz, renderChord, renderHatBar, renderHeartbeat, renderImpulse, renderRiser } from './synth'

function finiteAndBounded(channels: readonly Float32Array[], limit: number): boolean {
  return channels.every(channel => channel.every(sample => Number.isFinite(sample) && Math.abs(sample) <= limit + 1e-6))
}

describe('synthesized layers', () => {
  it('tunes to the track tonic', () => {
    expect(pitchHz('A', 4)).toBeCloseTo(440, 9)
    expect(pitchHz('C', 4)).toBeCloseTo(261.626, 3)
    expect(pitchHz('G', 5, 7)).toBeCloseTo(pitchHz('D', 6), 9)
  })

  it('renders the hat layer as exactly one bar of the race grid at common context rates', () => {
    for (const rate of [44100, 48000]) {
      const [left, right] = renderHatBar(rate, 'G')
      expect(left.length).toBe(Math.round(BAR_SECONDS * rate))
      expect(right.length).toBe(left.length)
      expect(finiteAndBounded([left, right], 0.5)).toBe(true)
    }
  })

  it('keeps the hat layer percussive when the key is unknown', () => {
    expect(finiteAndBounded(renderHatBar(48000, null), 0.5)).toBe(true)
  })

  it('renders one heartbeat cycle to loop', () => {
    const beat = renderHeartbeat(48000, 54)
    expect(beat.length).toBe(Math.round((60 / 54) * 48000))
    expect(finiteAndBounded([beat], 0.9)).toBe(true)
  })

  it('renders the chord, risers and reverb impulse without invalid samples', () => {
    expect(finiteAndBounded(renderChord(22050, 'A', 1), 0.6)).toBe(true)
    expect(finiteAndBounded(renderRiser(48000, 0.5, 300, 3800, 11), 0.5)).toBe(true)
    expect(finiteAndBounded(renderImpulse(48000, 1), 0.9)).toBe(true)
  })

  it('renders every race one-shot as a short, audible, bounded mono buffer', () => {
    // #given the synthesized race sounds at a common context rate
    for (const [id, render] of Object.entries(SYNTH_SOUNDS)) {
      // #when each is rendered
      const samples = render(48000)
      const peak = samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0)
      // #then it lasts under two seconds, has no invalid samples and is neither silent nor clipped
      expect(samples.length, id).toBeLessThan(2 * 48000)
      expect(finiteAndBounded([samples], 0.65), id).toBe(true)
      expect(peak, id).toBeGreaterThan(0.3)
    }
  })

  it('tells synthesized sound ids from shipped ones', () => {
    expect(isSynthSound('synth-tether')).toBe(true)
    expect(isSynthSound('land')).toBe(false)
    expect(isSynthSound('toString')).toBe(false)
  })
})
