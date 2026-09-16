import * as THREE from 'three'
import type { StationKit } from './kit'

/** Transit signage faces: DIN ships with iOS and macOS; condensed system faces stand in elsewhere. */
export const FONT = {
  sign: '"DIN Condensed", "Roboto Condensed", "Arial Narrow", sans-serif-condensed, sans-serif',
  figure: '"DIN Alternate", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif',
  text: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Helvetica Neue", Arial, sans-serif',
} as const

export type Painter = (context: CanvasRenderingContext2D) => void

/**
 * An in-world screen backed by a canvas. Drawing uses logical units; the canvas
 * holds `canvasScale` pixels per unit so text stays sharp on 2x displays.
 */
export interface CanvasDisplay {
  readonly texture: THREE.CanvasTexture
  readonly width: number
  readonly height: number
  /** Paints when `key` differs from the last painted key, and reports whether it did. */
  paint(key: string, painter: Painter): boolean
  /** Paints unconditionally, for brief transitions triggered by a data change. */
  repaint(painter: Painter): void
  dispose(): void
}

export function createCanvasDisplay(kit: StationKit, width: number, height: number): CanvasDisplay {
  const scale = kit.settings.canvasScale
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const context = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = Math.min(kit.settings.anisotropy, kit.renderer.capabilities.getMaxAnisotropy())
  let lastKey: string | null = null

  function draw(painter: Painter): void {
    if (!context) return
    context.setTransform(scale, 0, 0, scale, 0, 0)
    context.clearRect(0, 0, width, height)
    painter(context)
    texture.needsUpdate = true
  }

  return {
    texture,
    width,
    height,
    paint(key, painter) {
      if (key === lastKey) return false
      lastKey = key
      draw(painter)
      return true
    },
    repaint: draw,
    dispose() {
      texture.dispose()
      canvas.width = 0
      canvas.height = 0
    },
  }
}

export function setFont(context: CanvasRenderingContext2D, size: number, family: string, weight: number | 'normal' | 'bold' = 'bold'): void {
  context.font = `${weight} ${size}px ${family}`
}

/** `text` shortened with an ellipsis to fit `maxWidth` in the current font. */
export function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text
  const glyphs = Array.from(text)
  let low = 0
  let high = glyphs.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (context.measureText(`${glyphs.slice(0, middle).join('').trimEnd()}…`).width <= maxWidth) low = middle
    else high = middle - 1
  }
  return low === 0 ? '…' : `${glyphs.slice(0, low).join('').trimEnd()}…`
}

/** Baseline that visually centres capitals on `centerY` for the current font. */
export function capBaseline(context: CanvasRenderingContext2D, centerY: number): number {
  const metrics = context.measureText('H')
  return centerY + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2
}

export function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath()
  context.roundRect(x, y, width, height, radius)
}

/** A display plane that shows its canvas unlit, so ink colours stay true under tone mapping. */
export function createDisplayMaterial(kit: StationKit, display: CanvasDisplay): THREE.MeshBasicMaterial {
  return kit.track(new THREE.MeshBasicMaterial({ map: display.texture, toneMapped: false }))
}
