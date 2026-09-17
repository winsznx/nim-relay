import type { TourPlacement, TourRect, TourShape } from './types'

/** Pure layout for the spotlight and the coach mark, in viewport (client) coordinates. */

export interface Size {
  width: number
  height: number
}

export type CardPlacement = TourPlacement | 'center'

export const DEFAULT_PLACEMENTS: readonly TourPlacement[] = ['bottom', 'top', 'right', 'left']

export function inflate(rect: TourRect, by: number): TourRect {
  return { x: rect.x - by, y: rect.y - by, width: rect.width + by * 2, height: rect.height + by * 2 }
}

/** The spotlight around a target: a padded box, or the smallest circle holding a padded box. */
export function cutoutFor(target: TourRect, shape: TourShape, padding: number, radius: number): { rect: TourRect; radius: number } {
  if (shape === 'circle') {
    const size = Math.max(target.width, target.height) + padding * 2
    const cx = target.x + target.width / 2
    const cy = target.y + target.height / 2
    return { rect: { x: cx - size / 2, y: cy - size / 2, width: size, height: size }, radius: size / 2 }
  }
  const rect = inflate(target, padding)
  return { rect, radius: Math.min(radius + padding, rect.width / 2, rect.height / 2) }
}

/**
 * Four rectangles covering the viewport around a cutout: above, below, left and right of it. With no cutout the
 * first one covers everything.
 */
export function blockerRects(cutout: TourRect | null, viewport: Size): [TourRect, TourRect, TourRect, TourRect] {
  const empty = { x: 0, y: 0, width: 0, height: 0 }
  if (!cutout) return [{ x: 0, y: 0, width: viewport.width, height: viewport.height }, empty, empty, empty]
  const top = clamp(cutout.y, 0, viewport.height)
  const bottom = clamp(cutout.y + cutout.height, top, viewport.height)
  const left = clamp(cutout.x, 0, viewport.width)
  const right = clamp(cutout.x + cutout.width, left, viewport.width)
  return [
    { x: 0, y: 0, width: viewport.width, height: top },
    { x: 0, y: bottom, width: viewport.width, height: viewport.height - bottom },
    { x: 0, y: top, width: left, height: bottom - top },
    { x: right, y: top, width: viewport.width - right, height: bottom - top },
  ]
}

/** Whether a card fits entirely inside `bounds` on one side of the target without covering it. */
export function fitsOn(placement: TourPlacement, target: TourRect, card: Size, bounds: TourRect, gap: number): boolean {
  switch (placement) {
    case 'bottom':
      return card.width <= bounds.width && bounds.y + bounds.height - (target.y + target.height + gap) >= card.height
    case 'top':
      return card.width <= bounds.width && target.y - gap - bounds.y >= card.height
    case 'right':
      return card.height <= bounds.height && bounds.x + bounds.width - (target.x + target.width + gap) >= card.width
    case 'left':
      return card.height <= bounds.height && target.x - gap - bounds.x >= card.width
  }
}

/**
 * The first preferred side the card fits on, a side that still fits when `current` is given (so a card doesn't
 * jump while its target moves), or the center of `bounds` when no side fits or there is no target.
 */
export function choosePlacement(input: { target: TourRect | null; card: Size; bounds: TourRect; gap: number; preferences: readonly TourPlacement[]; current?: CardPlacement | null }): CardPlacement {
  const { target, card, bounds, gap, preferences, current } = input
  if (!target) return 'center'
  if (current && current !== 'center' && preferences.includes(current) && fitsOn(current, target, card, bounds, gap)) return current
  return preferences.find(placement => fitsOn(placement, target, card, bounds, gap)) ?? 'center'
}

/**
 * Where a card goes when no side of its target has room: centered across, and against whichever edge of `bounds`
 * leaves more of the target uncovered.
 */
export function overlayPosition(target: TourRect | null, card: Size, bounds: TourRect): { x: number; y: number } {
  const centered = centerIn(bounds, card)
  if (!target) return centered
  const roomAbove = target.y - bounds.y
  const roomBelow = bounds.y + bounds.height - (target.y + target.height)
  return { x: centered.x, y: roomBelow >= roomAbove ? bounds.y + Math.max(0, bounds.height - card.height) : bounds.y }
}

export function centerIn(bounds: TourRect, card: Size): { x: number; y: number } {
  return { x: bounds.x + Math.max(0, bounds.width - card.width) / 2, y: bounds.y + Math.max(0, bounds.height - card.height) / 2 }
}

/** Moves a card's top-left corner so the whole card stays inside `bounds`, top-left first when it can't fit. */
export function keepInside(position: { x: number; y: number }, card: Size, bounds: TourRect): { x: number; y: number } {
  return {
    x: Math.max(bounds.x, Math.min(position.x, bounds.x + bounds.width - card.width)),
    y: Math.max(bounds.y, Math.min(position.y, bounds.y + bounds.height - card.height)),
  }
}

export function lerpRect(from: TourRect, to: TourRect, t: number): TourRect {
  const mix = (a: number, b: number) => a + (b - a) * t
  return { x: mix(from.x, to.x), y: mix(from.y, to.y), width: mix(from.width, to.width), height: mix(from.height, to.height) }
}

export function sameRect(a: TourRect | null, b: TourRect | null, tolerance = 0.5): boolean {
  if (!a || !b) return a === b
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance && Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - clamp(t, 0, 1)) ** 3
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
