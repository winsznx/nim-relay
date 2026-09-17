import { describe, expect, it } from 'vitest'
import { blockerRects, centerIn, choosePlacement, cutoutFor, DEFAULT_PLACEMENTS, keepInside, lerpRect, overlayPosition } from './geometry'

/** A 390×844 phone with 12 px margins and the bottom navigation starting at 780. */
const PHONE = { x: 12, y: 12, width: 366, height: 756 }
const CARD = { width: 340, height: 170 }
const GAP = 14

describe('coach mark placement', () => {
  it('goes below a target near the top', () => {
    // #given the inbox's first section under the sheet header
    const target = { x: 16, y: 150, width: 358, height: 180 }
    // #when a placement is chosen
    // #then the card sits below it
    expect(choosePlacement({ target, card: CARD, bounds: PHONE, gap: GAP, preferences: DEFAULT_PLACEMENTS })).toBe('bottom')
  })

  it('falls back to above when there is no room below', () => {
    // #given the gold Play button in the bottom navigation
    const target = { x: 160, y: 758, width: 70, height: 70 }
    // #then the card goes above it
    expect(choosePlacement({ target, card: CARD, bounds: { ...PHONE, height: 820 }, gap: GAP, preferences: DEFAULT_PLACEMENTS })).toBe('top')
  })

  it('falls back to the sides when neither above nor below fits', () => {
    // #given a wide screen and a tall, narrow target in the middle of it
    const bounds = { x: 12, y: 12, width: 1256, height: 776 }
    const target = { x: 500, y: 40, width: 60, height: 720 }
    // #then right comes before left, and left is used when right is cramped
    expect([
      choosePlacement({ target, card: CARD, bounds, gap: GAP, preferences: DEFAULT_PLACEMENTS }),
      choosePlacement({ target: { ...target, x: 1100 }, card: CARD, bounds, gap: GAP, preferences: DEFAULT_PLACEMENTS }),
    ]).toEqual(['right', 'left'])
  })

  it('centers the card when no side fits, or when there is no target', () => {
    // #given a target that fills the screen
    const target = { x: 0, y: 40, width: 390, height: 740 }
    // #then only the center is left
    expect([choosePlacement({ target, card: CARD, bounds: PHONE, gap: GAP, preferences: DEFAULT_PLACEMENTS }), choosePlacement({ target: null, card: CARD, bounds: PHONE, gap: GAP, preferences: DEFAULT_PLACEMENTS })]).toEqual(['center', 'center'])
  })

  it('follows a step’s own preference order', () => {
    // #given a target with room on both sides vertically
    const target = { x: 16, y: 330, width: 358, height: 60 }
    // #then a step preferring top gets top
    expect(choosePlacement({ target, card: CARD, bounds: PHONE, gap: GAP, preferences: ['top', 'bottom'] })).toBe('top')
  })

  it('keeps the current side while it still fits, so a moving target doesn’t make the card jump', () => {
    // #given a card already above a target that now also has room below
    const target = { x: 16, y: 300, width: 358, height: 60 }
    // #then it stays above, and moves once above no longer fits
    expect([
      choosePlacement({ target, card: CARD, bounds: PHONE, gap: GAP, preferences: DEFAULT_PLACEMENTS, current: 'top' }),
      choosePlacement({ target: { ...target, y: 120 }, card: CARD, bounds: PHONE, gap: GAP, preferences: DEFAULT_PLACEMENTS, current: 'top' }),
    ]).toEqual(['top', 'bottom'])
  })
})

describe('spotlight geometry', () => {
  it('pads a rectangular cutout and keeps its corner radius within the shape', () => {
    // #when a 100×40 target with a 14 px radius is padded by 8
    const cutout = cutoutFor({ x: 50, y: 60, width: 100, height: 40 }, 'rect', 8, 14)
    // #then the cutout grows by 8 on each side and the radius by 8
    expect(cutout).toEqual({ rect: { x: 42, y: 52, width: 116, height: 56 }, radius: 22 })
  })

  it('wraps a circular cutout around the target’s center', () => {
    // #when a 58×40 button gets a circular cutout padded by 6
    const cutout = cutoutFor({ x: 100, y: 700, width: 58, height: 40 }, 'circle', 6, 0)
    // #then the circle is centered on it and wide enough for its longer side
    expect(cutout).toEqual({ rect: { x: 94, y: 685, width: 70, height: 70 }, radius: 35 })
  })

  it('surrounds the cutout with four blockers that cover the rest of the viewport exactly', () => {
    // #given a cutout on a 390×844 viewport
    const viewport = { width: 390, height: 844 }
    const cutout = { x: 40, y: 100, width: 200, height: 80 }
    // #when the blockers are laid out
    const blockers = blockerRects(cutout, viewport)
    // #then they tile the viewport minus the cutout
    const covered = blockers.reduce((area, rect) => area + rect.width * rect.height, 0)
    expect({ blockers, covered }).toEqual({
      blockers: [
        { x: 0, y: 0, width: 390, height: 100 },
        { x: 0, y: 180, width: 390, height: 664 },
        { x: 0, y: 100, width: 40, height: 80 },
        { x: 240, y: 100, width: 150, height: 80 },
      ],
      covered: 390 * 844 - 200 * 80,
    })
  })

  it('blocks the whole viewport when there is no cutout, and clamps cutouts reaching past its edges', () => {
    // #when there is no cutout, and when the cutout sticks out of the viewport
    const viewport = { width: 390, height: 844 }
    const none = blockerRects(null, viewport)[0]
    const wide = blockerRects({ x: -10, y: 70, width: 410, height: 390 }, viewport)
    // #then one blocker covers everything, and no blocker has a negative size
    expect({ none, sizes: wide.every(rect => rect.width >= 0 && rect.height >= 0), top: wide[0] }).toEqual({ none: { x: 0, y: 0, width: 390, height: 844 }, sizes: true, top: { x: 0, y: 0, width: 390, height: 70 } })
  })

  it('centers and contains cards, and blends rectangles for the glide between targets', () => {
    // #then a centered card sits in the middle, an overflowing card is pulled inside, and halfway is halfway
    expect({
      centered: centerIn(PHONE, CARD),
      contained: keepInside({ x: 200, y: 700 }, CARD, PHONE),
      halfway: lerpRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 20, width: 30, height: 50 }, 0.5),
    }).toEqual({ centered: { x: 25, y: 305 }, contained: { x: 38, y: 598 }, halfway: { x: 5, y: 10, width: 20, height: 30 } })
  })
})

describe('cards with no room beside their target', () => {
  it('sit against the edge that leaves more of the target showing', () => {
    // #given a tall target with a little more room above than below, and one with more room below
    const high = { x: 16, y: 120, width: 358, height: 560 }
    const low = { x: 16, y: 40, width: 358, height: 560 }
    // #then the card goes to the top edge for the first and the bottom edge for the second, and centers with no target
    expect([overlayPosition(high, CARD, PHONE), overlayPosition(low, CARD, PHONE), overlayPosition(null, CARD, PHONE)]).toEqual([
      { x: 25, y: 12 },
      { x: 25, y: 598 },
      { x: 25, y: 305 },
    ])
  })
})
