/**
 * Adaptive render quality. Tiers only change presentation cost (resolution,
 * shadows, particles, bloom, draw distance, prop density) and never gameplay:
 * the simulation runs identically on every tier.
 */

export type QualityTier = 'low' | 'medium' | 'high'

export interface QualitySettings {
  tier: QualityTier
  /** Upper bound for the renderer pixel ratio. */
  dprCap: number
  shadows: boolean
  shadowMapSize: number
  /** Pooled particle capacity. */
  particles: number
  bloom: boolean
  /** Metres of route built and drawn ahead of the courier. */
  drawDistance: number
  /** 0..1 multiplier on instanced world props. */
  propDensity: number
  /** Ambient weather particles (rain, snow, spray). */
  weather: number
  speedStreaks: number
}

export const QUALITY: Readonly<Record<QualityTier, QualitySettings>> = {
  low: { tier: 'low', dprCap: 1.25, shadows: false, shadowMapSize: 512, particles: 160, bloom: false, drawDistance: 230, propDensity: 0.45, weather: 260, speedStreaks: 24 },
  medium: { tier: 'medium', dprCap: 1.75, shadows: true, shadowMapSize: 1024, particles: 320, bloom: false, drawDistance: 300, propDensity: 0.75, weather: 600, speedStreaks: 48 },
  high: { tier: 'high', dprCap: 2, shadows: true, shadowMapSize: 1024, particles: 520, bloom: true, drawDistance: 340, propDensity: 1, weather: 1100, speedStreaks: 72 },
}

const TIER_ORDER: readonly QualityTier[] = ['low', 'medium', 'high']

export interface DeviceProfile {
  devicePixelRatio: number
  hardwareConcurrency: number
  /** Unmasked WebGL renderer string when available. */
  renderer: string
  /** Narrow viewports are phones; their GPUs get less headroom. */
  viewportWidth: number
}

const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|software|basic render|microsoft basic/i
const LOW_END_GPUS = /mali-[gt]\d{1,2}\b|adreno \(tm\) [1-5]\d\d\b|powervr|apple a(9|10|11)\b|intel\(r\) hd graphics [2-5]\d{2,3}\b/i
/** WebKit masks the model and reports core counts coarsely, so an Apple GPU is judged on its own. */
const APPLE_GPU = /^apple gpu$/i
const HIGH_END_GPUS = /apple m\d|apple a1[5-9]|rtx|radeon rx|geforce gtx 1[06-9]|adreno \(tm\) 7\d\d/i

export function detectQualityTier(profile: DeviceProfile): QualityTier {
  if (SOFTWARE_RENDERERS.test(profile.renderer)) return 'low'
  if (LOW_END_GPUS.test(profile.renderer)) return 'low'
  const phone = profile.viewportWidth < 700
  if (APPLE_GPU.test(profile.renderer.trim())) return phone ? 'medium' : 'high'
  const cores = profile.hardwareConcurrency || 4
  if (cores <= 4) return 'low'
  if (HIGH_END_GPUS.test(profile.renderer) && cores >= 6) return phone ? 'medium' : 'high'
  if (phone) return profile.devicePixelRatio >= 3 && cores >= 6 ? 'medium' : 'low'
  return cores >= 8 ? 'high' : 'medium'
}

export function lowerTier(tier: QualityTier): QualityTier | null {
  const index = TIER_ORDER.indexOf(tier)
  return index > 0 ? TIER_ORDER[index - 1]! : null
}

const WINDOW = 90
const WARMUP_FRAMES = 45
const SLOW_FRAME_MS = 24
const SLOW_SHARE = 0.35
const COOLDOWN_FRAMES = 150

/**
 * Watches frame times and asks for a lower tier when a sustained share of
 * frames misses budget. It never upgrades mid-race: a flip-flopping tier is
 * more distracting than a slightly softer image.
 */
export class FrameBudgetMonitor {
  private readonly times = new Float32Array(WINDOW)
  private cursor = 0
  private filled = 0
  private seen = 0
  private cooldown = 0

  sample(frameMs: number): boolean {
    this.seen++
    if (this.seen <= WARMUP_FRAMES || !Number.isFinite(frameMs)) return false
    this.times[this.cursor] = Math.min(frameMs, 250)
    this.cursor = (this.cursor + 1) % WINDOW
    this.filled = Math.min(WINDOW, this.filled + 1)
    if (this.cooldown > 0) {
      this.cooldown--
      return false
    }
    if (this.filled < WINDOW) return false
    let slow = 0
    for (let i = 0; i < WINDOW; i++) if (this.times[i]! > SLOW_FRAME_MS) slow++
    if (slow / WINDOW < SLOW_SHARE) return false
    this.cooldown = COOLDOWN_FRAMES
    this.filled = 0
    return true
  }

  reset(): void {
    this.filled = 0
    this.cursor = 0
    this.cooldown = COOLDOWN_FRAMES
  }
}
