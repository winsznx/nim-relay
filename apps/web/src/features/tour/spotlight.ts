import { computePosition, offset, shift } from '@floating-ui/dom'
import { blockerRects, centerIn, choosePlacement, cutoutFor, easeOutCubic, inflate, keepInside, lerpRect, overlayPosition, sameRect, type CardPlacement, type Size } from './geometry'
import { isUsableTarget, rectOf, tourTarget } from './targets'
import type { TourInteraction, TourPlacement, TourRect, TourShape } from './types'

/**
 * Draws the spotlight and places the coach mark, outside React. Each animation frame it measures the target, so the
 * cutout follows sheets that spring in, scroll or resize, and it writes to the DOM only what changed.
 */

export const GLIDE_MS = 280
const CARD_GAP = 14
const SCREEN_MARGIN = 12
/** Space kept between a card and the bottom navigation when the target is above it. */
const NAV_CLEARANCE = 8
/** How far inside the viewport's edges a rectangular cutout stays. */
const EDGE_INSET = 3
const ARROW_SIZE = 14
const ARROW_EDGE = 20

export interface SpotlightParts {
  /** The cutout in the veil's mask. */
  hole: SVGRectElement
  ring: HTMLElement
  /** Above, below, left and right of the cutout. */
  blockers: readonly HTMLElement[]
  /** Over the cutout itself, for steps whose target must not be used. */
  cover: HTMLElement
  /** Padded with the safe-area insets, so they can be read in pixels. */
  probe: HTMLElement
}

export interface SpotlightFocus {
  target: Element | null
  /** Finds the target again if a render replaced its element. */
  selector: string | null
  measure: ((element: Element) => TourRect | null) | null
  shape: TourShape
  padding: number
  interaction: TourInteraction
  placements: readonly TourPlacement[]
  card: HTMLElement | null
  arrow: HTMLElement | null
}

interface Cutout {
  rect: TourRect
  radius: number
}

interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

function cornerRadius(element: Element | null): number {
  if (!element) return 0
  return Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0
}

function px(value: number): string {
  return `${Math.round(value * 10) / 10}px`
}

export class Spotlight {
  private focus: SpotlightFocus | null = null
  private radius = 0
  private nav: Element | null = null
  private shown: Cutout | null = null
  /** Held in place while the next target is found. */
  private frozen: Cutout | null = null
  private glide: { from: Cutout | null; start: number } | null = null
  private frame = 0
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }
  private insetsStale = true
  private placement: CardPlacement | null = null
  private positioned: { target: TourRect | null; bounds: TourRect; size: Size } | null = null
  private positionRequest = 0
  private readonly written = new Map<object, string>()
  private reducedMotion = false
  /** The target's latest measured box, kept while a render swaps its element or it can't be measured. */
  private lastTarget: TourRect | null = null

  constructor(private readonly parts: SpotlightParts) {}

  start(): void {
    window.addEventListener('resize', this.onViewportChange)
    window.addEventListener('orientationchange', this.onViewportChange)
    window.visualViewport?.addEventListener('resize', this.onViewportChange)
    window.visualViewport?.addEventListener('scroll', this.onViewportChange)
    this.frame = requestAnimationFrame(this.tick)
  }

  stop(): void {
    cancelAnimationFrame(this.frame)
    window.removeEventListener('resize', this.onViewportChange)
    window.removeEventListener('orientationchange', this.onViewportChange)
    window.visualViewport?.removeEventListener('resize', this.onViewportChange)
    window.visualViewport?.removeEventListener('scroll', this.onViewportChange)
    this.positionRequest++
  }

  /** While the next target is being found: the cutout stays where it is, closed to taps, and the card is put away. */
  hold(): void {
    if (!this.focus) return
    this.frozen = this.shown
    this.focus = { ...this.focus, target: null, interaction: 'next', card: null, arrow: null }
  }

  /** Points at a new target, or at nothing, gliding there from what is shown now. */
  setFocus(focus: SpotlightFocus | null): void {
    this.frozen = null
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.focus = focus
    this.lastTarget = null
    this.radius = cornerRadius(focus?.target ?? null)
    this.nav = document.querySelector(tourTarget('bottom-nav'))
    this.glide = { from: this.shown, start: performance.now() }
    this.placement = null
    this.positioned = null
    this.render(performance.now())
  }

  private readonly onViewportChange = (): void => {
    this.insetsStale = true
    this.positioned = null
    this.render(performance.now())
  }

  private readonly tick = (now: number): void => {
    this.frame = requestAnimationFrame(this.tick)
    this.render(now)
  }

  private render(now: number): void {
    const target = this.measureTarget()
    const goal = this.frozen ?? (target && this.focus ? this.cutout(target, this.focus) : null)
    this.shown = this.frozen ?? this.animate(goal, now)
    this.draw(this.shown)
    this.placeCard(goal?.rect ?? null)
  }

  /** A rectangular cutout stays inside the viewport so its ring is whole even for targets at the screen's edge. */
  private cutout(target: TourRect, focus: SpotlightFocus): Cutout {
    const cutout = cutoutFor(target, focus.shape, focus.padding, this.radius)
    if (focus.shape === 'circle') return cutout
    const left = Math.max(EDGE_INSET, cutout.rect.x)
    const top = Math.max(EDGE_INSET, cutout.rect.y)
    const right = Math.min(window.innerWidth - EDGE_INSET, cutout.rect.x + cutout.rect.width)
    const bottom = Math.min(window.innerHeight - EDGE_INSET, cutout.rect.y + cutout.rect.height)
    return { rect: { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }, radius: cutout.radius }
  }

  private measureTarget(): TourRect | null {
    const focus = this.focus
    if (!focus?.target) return null
    if (!focus.target.isConnected && focus.selector) {
      const replacement = [...document.querySelectorAll(focus.selector)].find(isUsableTarget)
      if (replacement) focus.target = replacement
    }
    if (!focus.target.isConnected) return this.lastTarget
    const measured = focus.measure ? (focus.measure(focus.target) ?? this.lastTarget ?? rectOf(focus.target)) : rectOf(focus.target)
    this.lastTarget = measured
    return measured
  }

  private animate(goal: Cutout | null, now: number): Cutout | null {
    const glide = this.glide
    if (!glide) return goal
    const progress = this.reducedMotion ? 1 : (now - glide.start) / GLIDE_MS
    if (progress >= 1) {
      this.glide = null
      return goal
    }
    const eased = easeOutCubic(progress)
    // The first cutout closes in on its target; a cutout with nowhere to go closes into its own center.
    const from = glide.from ?? (goal ? { rect: inflate(goal.rect, 28), radius: goal.radius + 28 } : null)
    if (!from) return null
    const to = goal ?? { rect: { x: from.rect.x + from.rect.width / 2, y: from.rect.y + from.rect.height / 2, width: 0, height: 0 }, radius: 0 }
    return { rect: lerpRect(from.rect, to.rect, eased), radius: from.radius + (to.radius - from.radius) * eased }
  }

  private draw(cutout: Cutout | null): void {
    const { hole, ring, blockers, cover } = this.parts
    const rect = cutout?.rect ?? { x: 0, y: 0, width: 0, height: 0 }
    const radius = Math.max(0, Math.min(cutout?.radius ?? 0, rect.width / 2, rect.height / 2))
    this.write(hole, `${rect.x},${rect.y},${rect.width},${rect.height},${radius}`, () => {
      hole.setAttribute('x', String(rect.x))
      hole.setAttribute('y', String(rect.y))
      hole.setAttribute('width', String(rect.width))
      hole.setAttribute('height', String(rect.height))
      hole.setAttribute('rx', String(radius))
      hole.setAttribute('ry', String(radius))
    })
    const visible = cutout !== null && rect.width > 1 && rect.height > 1
    this.write(ring, visible ? `${rect.x},${rect.y},${rect.width},${rect.height},${radius}` : 'hidden', () => {
      ring.style.visibility = visible ? 'visible' : 'hidden'
      ring.style.transform = `translate3d(${px(rect.x)}, ${px(rect.y)}, 0)`
      ring.style.width = px(rect.width)
      ring.style.height = px(rect.height)
      ring.style.borderRadius = px(radius)
    })
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    blockerRects(visible ? rect : null, viewport).forEach((area, index) => {
      const blocker = blockers[index]
      if (blocker) this.place(blocker, area)
    })
    const covered = visible && this.focus?.interaction !== 'tap-target'
    this.place(cover, covered ? rect : { x: 0, y: 0, width: 0, height: 0 })
  }

  private place(element: HTMLElement, area: TourRect): void {
    this.write(element, `${area.x},${area.y},${area.width},${area.height}`, () => {
      element.style.transform = `translate3d(${px(area.x)}, ${px(area.y)}, 0)`
      element.style.width = px(area.width)
      element.style.height = px(area.height)
    })
  }

  private write(element: object, key: string, apply: () => void): void {
    if (this.written.get(element) === key) return
    this.written.set(element, key)
    apply()
  }

  /** The visible viewport minus safe areas and a margin, and minus the bottom navigation unless the target is in it. */
  private bounds(target: TourRect | null): TourRect {
    const viewport = window.visualViewport
    const left = (viewport?.offsetLeft ?? 0) + this.safeInsets().left + SCREEN_MARGIN
    const top = (viewport?.offsetTop ?? 0) + this.safeInsets().top + SCREEN_MARGIN
    const right = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - this.safeInsets().right - SCREEN_MARGIN
    let bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - this.safeInsets().bottom - SCREEN_MARGIN
    const navTop = this.nav?.isConnected ? this.nav.getBoundingClientRect().top : null
    if (navTop !== null && navTop > top && (!target || target.y + target.height <= navTop + 1)) bottom = Math.min(bottom, navTop - NAV_CLEARANCE)
    return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
  }

  private safeInsets(): Insets {
    if (this.insetsStale) {
      const style = getComputedStyle(this.parts.probe)
      this.insets = {
        top: Number.parseFloat(style.paddingTop) || 0,
        right: Number.parseFloat(style.paddingRight) || 0,
        bottom: Number.parseFloat(style.paddingBottom) || 0,
        left: Number.parseFloat(style.paddingLeft) || 0,
      }
      this.insetsStale = false
    }
    return this.insets
  }

  private placeCard(target: TourRect | null): void {
    const focus = this.focus
    const card = focus?.card
    if (!focus || !card?.isConnected) return
    const size = { width: card.offsetWidth, height: card.offsetHeight }
    const bounds = this.bounds(target)
    const last = this.positioned
    if (last && sameRect(last.target, target) && sameRect(last.bounds, bounds) && last.size.width === size.width && last.size.height === size.height) return
    this.positioned = { target, bounds, size }
    const placement = choosePlacement({ target, card: size, bounds, gap: CARD_GAP, preferences: focus.placements, current: this.placement })
    this.placement = placement
    const request = ++this.positionRequest
    if (placement === 'center' || !target) {
      this.applyCard(card, overlayPosition(target, size, bounds), 'center', target, size)
      return
    }
    const reference = { getBoundingClientRect: () => ({ ...target, top: target.y, left: target.x, right: target.x + target.width, bottom: target.y + target.height }) }
    computePosition(reference, card, { strategy: 'fixed', placement, middleware: [offset(CARD_GAP), shift({ boundary: bounds, padding: 0 })] })
      .then(result => {
        if (request === this.positionRequest) this.applyCard(card, keepInside(result, size, bounds), placement, target, size)
      })
      .catch((error: unknown) => {
        console.warn('Coach mark placement fell back to the center', error)
        if (request === this.positionRequest) this.applyCard(card, centerIn(bounds, size), 'center', target, size)
      })
  }

  private applyCard(card: HTMLElement, position: { x: number; y: number }, placement: CardPlacement, target: TourRect | null, size: Size): void {
    card.style.transform = `translate3d(${Math.round(position.x)}px, ${Math.round(position.y)}px, 0)`
    card.dataset.placement = placement
    card.dataset.positioned = 'true'
    const arrow = this.focus?.arrow
    if (!arrow) return
    if (placement === 'center' || !target) {
      arrow.style.left = ''
      arrow.style.top = ''
      return
    }
    const clamp = (value: number, length: number) => Math.max(ARROW_EDGE, Math.min(value, length - ARROW_EDGE - ARROW_SIZE))
    if (placement === 'top' || placement === 'bottom') {
      arrow.style.left = px(clamp(target.x + target.width / 2 - position.x - ARROW_SIZE / 2, size.width))
      arrow.style.top = ''
    } else {
      arrow.style.top = px(clamp(target.y + target.height / 2 - position.y - ARROW_SIZE / 2, size.height))
      arrow.style.left = ''
    }
  }
}
