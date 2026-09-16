export type QualityName = 'low' | 'medium' | 'high'

export interface QualityTier {
  name: QualityName
  /** Upper bound for the renderer pixel ratio. */
  dprCap: number
  sphereSegments: readonly [number, number]
  /** Samples along each relay arc. */
  arcSegments: number
  textureWidth: number
  /** Points in each comet's tail. */
  trailPoints: number
  stars: number
  cityLights: boolean
}

const TIERS: Record<QualityName, QualityTier> = {
  low: { name: 'low', dprCap: 1.25, sphereSegments: [48, 32], arcSegments: 28, textureWidth: 1024, trailPoints: 8, stars: 220, cityLights: false },
  medium: { name: 'medium', dprCap: 2, sphereSegments: [72, 48], arcSegments: 48, textureWidth: 2048, trailPoints: 14, stars: 520, cityLights: true },
  high: { name: 'high', dprCap: 2, sphereSegments: [96, 64], arcSegments: 64, textureWidth: 2048, trailPoints: 18, stars: 900, cityLights: true },
}

/** A conservative first guess; the frame monitor lowers resolution if the device cannot keep up. */
export function initialTier(): QualityTier {
  const cores = navigator.hardwareConcurrency || 4
  const memory = 'deviceMemory' in navigator && typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : 4
  if (cores <= 4 || memory <= 2) return TIERS.low
  if (window.matchMedia('(pointer: coarse)').matches) return TIERS.medium
  return TIERS.high
}

/**
 * Watches frame times and steps the pixel ratio down when frames run long,
 * which keeps interaction smooth in constrained WebViews.
 */
export class FrameMonitor {
  private samples = 0
  private slow = 0
  constructor(
    private pixelRatio: number,
    private readonly apply: (pixelRatio: number) => void,
  ) {}

  record(deltaMs: number): void {
    if (deltaMs > 100) return
    this.samples++
    if (deltaMs > 24) this.slow++
    if (this.samples < 120) return
    if (this.slow > 40 && this.pixelRatio > 1) {
      this.pixelRatio = Math.max(1, this.pixelRatio - 0.25)
      this.apply(this.pixelRatio)
    }
    this.samples = 0
    this.slow = 0
  }
}
