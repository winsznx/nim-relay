/** Canvas drawing helpers shared by the share card frame and its motifs. */

export const CARD_WIDTH = 1080
export const CARD_HEIGHT = 1350

export const SANS = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

export const COLORS = {
  midnight: '#05070F',
  night: '#0A0E1A',
  ink: '#F5F7FA',
  inkSoft: '#C9D0DE',
  mist: '#9AA3B8',
  mistDim: '#737C92',
  gold: '#F5A623',
  goldLight: '#FFD48C',
  goldDeep: '#B8650A',
  cyan: '#22D3EE',
} as const

export type Context = CanvasRenderingContext2D

/** A pointy-top hexagon, the shape of the baton. */
export function hexagonPath(context: Context, x: number, y: number, radius: number): void {
  context.beginPath()
  for (let corner = 0; corner < 6; corner++) {
    const angle = (Math.PI / 3) * corner - Math.PI / 2
    const px = x + radius * Math.cos(angle)
    const py = y + radius * Math.sin(angle)
    if (corner === 0) context.moveTo(px, py)
    else context.lineTo(px, py)
  }
  context.closePath()
}

/** A glowing gold baton: soft halo, faceted hexagon and inner bevel. */
export function drawBaton(context: Context, x: number, y: number, radius: number, color: string = COLORS.gold): void {
  const halo = context.createRadialGradient(x, y, radius * 0.4, x, y, radius * 4)
  halo.addColorStop(0, withAlpha(color, 0.5))
  halo.addColorStop(1, withAlpha(color, 0))
  context.fillStyle = halo
  context.fillRect(x - radius * 4, y - radius * 4, radius * 8, radius * 8)
  const body = context.createLinearGradient(x - radius, y - radius, x + radius, y + radius)
  body.addColorStop(0, mix(color, '#FFFFFF', 0.55))
  body.addColorStop(0.5, color)
  body.addColorStop(1, mix(color, '#000000', 0.35))
  context.fillStyle = body
  hexagonPath(context, x, y, radius)
  context.fill()
  context.strokeStyle = 'rgba(255, 246, 222, 0.55)'
  context.lineWidth = Math.max(1.5, radius * 0.05)
  hexagonPath(context, x, y, radius * 0.68)
  context.stroke()
}

export type Point = readonly [number, number]

/** The point at `t` along a quadratic curve. */
export function quadraticPoint(from: Point, control: Point, to: Point, t: number): [number, number] {
  const u = 1 - t
  return [u * u * from[0] + 2 * u * t * control[0] + t * t * to[0], u * u * from[1] + 2 * u * t * control[1] + t * t * to[1]]
}

/** Deterministic pseudo-random numbers, so a card redraws identically. */
export function seededRandom(seedText: string): () => number {
  let seed = 2166136261
  for (let index = 0; index < seedText.length; index++) seed = Math.imul(seed ^ seedText.charCodeAt(index), 16777619)
  return () => {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822507)
    seed = Math.imul(seed ^ (seed >>> 13), 3266489909)
    seed ^= seed >>> 16
    return (seed >>> 0) / 4294967296
  }
}

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function mix(hex: string, other: string, amount: number): string {
  const a = channels(hex)
  const b = channels(other)
  const blend = a.map((value, index) => Math.round(value + ((b[index] ?? value) - value) * amount))
  return `rgb(${blend.join(', ')})`
}

/**
 * Heavy italic display type, condensed. System faces that ship a condensed
 * width use it; elsewhere the glyphs are narrowed, which keeps the headline's
 * broadcast feel on every device.
 */
export interface DisplayFace {
  use(size: number): void
  measure(text: string): number
  fill(text: string, x: number, y: number): void
}

export function displayFace(context: Context): DisplayFace {
  const sample = 'RELAY HANDOFF 0123'
  context.font = `italic 900 100px ${SANS}`
  context.fontStretch = 'normal'
  const regular = context.measureText(sample).width
  context.fontStretch = 'condensed'
  const native = context.measureText(sample).width < regular * 0.97
  const squeeze = native ? 1 : 0.86
  let size = 100
  const apply = () => {
    context.font = `italic 900 ${size}px ${SANS}`
    context.fontStretch = native ? 'condensed' : 'normal'
    context.letterSpacing = '0px'
  }
  return {
    use(next) {
      size = next
      apply()
    },
    measure: text => context.measureText(text).width * squeeze,
    fill(text, x, y) {
      apply()
      context.save()
      context.translate(x, y)
      context.scale(squeeze, 1)
      context.fillText(text, 0, 0)
      context.restore()
    },
  }
}

/** Greedy word wrap at ordinary spaces, so no-break spaces hold names together. Null when one word is wider than the line. */
export function wrapWords(measure: (text: string) => number, text: string, maxWidth: number): string[] | null {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/ +/).filter(Boolean)) {
    if (measure(word) > maxWidth) return null
    const candidate = line ? `${line} ${word}` : word
    if (measure(candidate) <= maxWidth) line = candidate
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

/** Shortens `text` with an ellipsis until it fits. */
export function fitText(context: Context, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text
  let trimmed = text
  while (trimmed.length > 1 && context.measureText(`${trimmed}…`).width > maxWidth) trimmed = trimmed.slice(0, -1)
  return `${trimmed.trimEnd()}…`
}

export function setType(context: Context, font: string, color: string, tracking = 0): void {
  context.font = font
  context.fontStretch = 'normal'
  context.fillStyle = color
  context.letterSpacing = `${tracking}px`
}
