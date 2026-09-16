import type { QualityPreference, QualityTier } from './types'

export interface QualitySettings {
  tier: QualityTier
  maxPixelRatio: number
  antialias: boolean
  shadows: boolean
  /** Prefiltered night environment for reflections on metal and glass. */
  environmentMap: boolean
  /** Canvas pixels per display unit; 2 keeps text crisp on 2x screens. */
  canvasScale: number
  anisotropy: number
  towers: number
  stars: number
  cityLights: number
  dust: number
  pods: number
  /** Solari-style shuffle when the departure board changes. */
  boardShuffle: boolean
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  high: {
    tier: 'high',
    maxPixelRatio: 2,
    antialias: true,
    shadows: true,
    environmentMap: true,
    canvasScale: 2,
    anisotropy: 8,
    towers: 180,
    stars: 1400,
    cityLights: 2200,
    dust: 420,
    pods: 7,
    boardShuffle: true,
  },
  medium: {
    tier: 'medium',
    maxPixelRatio: 1.5,
    antialias: true,
    shadows: false,
    environmentMap: true,
    canvasScale: 2,
    anisotropy: 4,
    towers: 130,
    stars: 900,
    cityLights: 1400,
    dust: 240,
    pods: 5,
    boardShuffle: true,
  },
  low: {
    tier: 'low',
    maxPixelRatio: 1,
    antialias: false,
    shadows: false,
    environmentMap: false,
    canvasScale: 1.5,
    anisotropy: 2,
    towers: 80,
    stars: 500,
    cityLights: 700,
    dust: 90,
    pods: 3,
    boardShuffle: false,
  },
}

export function resolveQuality(preference: QualityPreference = 'auto'): QualitySettings {
  return QUALITY[preference === 'auto' ? detectTier() : preference]
}

/** A coarse first guess; the frame monitor steps down from here when frames run long. */
function detectTier(): QualityTier {
  const cores = navigator.hardwareConcurrency || 4
  const memory: unknown = Reflect.get(navigator, 'deviceMemory')
  if (typeof memory === 'number' && memory <= 2) return 'low'
  if (cores >= 6) return 'high'
  return cores >= 4 ? 'medium' : 'low'
}

const WARMUP_SECONDS = 2
const SAMPLE_FRAMES = 90
const SLOW_FRAME_SECONDS = 1 / 42

export interface FrameMonitor {
  /** Returns true when the renderer should shed pixels. */
  sample(delta: number, elapsed: number): boolean
}

export function createFrameMonitor(): FrameMonitor {
  let frames = 0
  let total = 0
  return {
    sample(delta, elapsed) {
      if (elapsed < WARMUP_SECONDS) return false
      frames++
      total += delta
      if (frames < SAMPLE_FRAMES) return false
      const slow = total / frames > SLOW_FRAME_SECONDS
      frames = 0
      total = 0
      return slow
    },
  }
}
