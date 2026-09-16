import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { SOUNDS, TRACKS } from '../src/features/audio/tracks'

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url))
const AUDIO_DIRS = ['music', 'ambience', 'sfx']
/** Matches BUDGET_BYTES in scripts/assets/audio/plan.mjs. */
const BUDGET_BYTES = 6_500_000
const DURATION_TOLERANCE_SECONDS = 0.02
const WORLDS = ['coast', 'metro', 'alpine', 'solar', 'ocean']

interface Decoded {
  url: string
  status: number
  bytes: number
  duration: number
  channels: number
  error: string | null
}

const tracks = Object.values(TRACKS)
const sounds = Object.values(SOUNDS)
const urls = [...tracks.map(track => track.url), ...sounds.map(sound => sound.url)]
const diskBytes = (url: string) => statSync(`${PUBLIC_DIR}${url}`).size

test('every shipped audio file is listed, served, decodes, and has its declared length', async ({ page }) => {
  const onDisk = AUDIO_DIRS.flatMap(dir => readdirSync(`${PUBLIC_DIR}/assets/audio/${dir}`).map(name => `/assets/audio/${dir}/${name}`))
  expect([...onDisk].sort()).toEqual([...urls].sort())

  await page.goto('/assets/manifest.json')
  const decoded: Decoded[] = await page.evaluate(async list => {
    const ctx = new AudioContext({ sampleRate: 44100 })
    const results: Decoded[] = []
    for (const url of list) {
      const response = await fetch(url, { cache: 'no-store' })
      const data = await response.arrayBuffer()
      const base = { url, status: response.status, bytes: data.byteLength }
      try {
        const buffer = await ctx.decodeAudioData(data)
        results.push({ ...base, duration: buffer.duration, channels: buffer.numberOfChannels, error: null })
      } catch (error) {
        results.push({ ...base, duration: 0, channels: 0, error: String(error) })
      }
    }
    await ctx.close()
    return results
  }, urls)

  const byUrl = new Map(decoded.map(result => [result.url, result]))
  for (const url of urls) {
    const result = byUrl.get(url)
    expect(result?.status, url).toBe(200)
    // The dev server answers unknown paths with index.html; matching bytes proves this is the file.
    expect(result?.bytes, url).toBe(diskBytes(url))
    expect(result?.error, url).toBeNull()
  }
  for (const track of tracks) {
    expect(Math.abs((byUrl.get(track.url)?.duration ?? 0) - track.loopSeconds), `${track.id} loop length`).toBeLessThanOrEqual(DURATION_TOLERANCE_SECONDS)
  }
  for (const sound of sounds) {
    const result = byUrl.get(sound.url)
    expect(Math.abs((result?.duration ?? 0) - sound.seconds), `${sound.id} length`).toBeLessThanOrEqual(DURATION_TOLERANCE_SECONDS)
    expect(result?.channels, sound.id).toBe(sound.channels)
  }

  const total = urls.reduce((sum, url) => sum + diskBytes(url), 0)
  expect(total).toBeLessThanOrEqual(BUDGET_BYTES)
})

test('race tracks sit on the 144 BPM pulse grid and cover every world once', () => {
  const race = tracks.filter(track => track.role === 'race')
  for (const track of race) {
    expect(track.bpm, track.id).toBe(144)
    expect(track.bars, track.id).not.toBeNull()
    expect(track.loopSeconds, track.id).toBeCloseTo(((track.bars ?? 0) * 4 * 60) / 144, 6)
  }
  expect(race.flatMap(track => track.worlds).sort()).toEqual([...WORLDS].sort())
})

test('every shipped audio file is credited as CC0 in the asset manifest', () => {
  const manifest: { assets: { path: string; license: string; source: string; author: string; modifications?: string[] }[] } = JSON.parse(readFileSync(`${PUBLIC_DIR}/assets/manifest.json`, 'utf8'))
  const audio = new Map(manifest.assets.filter(asset => asset.path.startsWith('audio/')).map(asset => [`/assets/${asset.path}`, asset]))
  expect([...audio.keys()].sort()).toEqual([...urls].sort())
  for (const [url, asset] of audio) {
    expect(asset.license, url).toBe('CC0-1.0')
    expect(asset.source, url).toMatch(/^https:\/\//)
    expect(asset.author, url).toBeTruthy()
    expect(asset.modifications?.length, url).toBeGreaterThan(0)
  }
})
