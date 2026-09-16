import { localFailure } from '../../shell/errors'
import { CARD_HEIGHT, CARD_WIDTH, COLORS, SANS, displayFace, fitText, hexagonPath, setType, withAlpha, wrapWords, type Context, type DisplayFace } from './canvas-kit'
import type { CardLayout, CardStat } from './layout'
import { drawGlobe, drawMotif } from './motifs'

const MARGIN = 88
const CONTENT = CARD_WIDTH - MARGIN * 2
/** The headline may rise this far up the card before it would cover the motif. */
const HEADLINE_CEILING = 610

interface Headline {
  size: number
  lineHeight: number
  lines: string[]
}

/** Breaks at " · " first, so "CT HUMBS · 17-DAY RELAY STREAK" sets as a name over its streak. */
function fitHeadline(face: DisplayFace, text: string, maxHeight: number): Headline {
  const segments = text.split(' · ')
  for (let size = 156; size >= 64; size -= 4) {
    face.use(size)
    const lineHeight = Math.round(size * 0.93)
    const bySegment = segments.map(segment => wrapWords(face.measure, segment, CONTENT))
    const segmented = bySegment.every(lines => lines !== null) ? bySegment.flatMap(lines => lines ?? []) : null
    const flowing = wrapWords(face.measure, segments.join(' '), CONTENT)
    for (const lines of [segmented, flowing]) {
      if (lines && lines.length <= 4 && lines.length * lineHeight <= maxHeight) return { size, lineHeight, lines }
    }
  }
  face.use(64)
  return { size: 64, lineHeight: 60, lines: [text] }
}

function drawBackdrop(context: Context, layout: CardLayout, textTop: number): void {
  context.fillStyle = COLORS.midnight
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
  const glow = context.createRadialGradient(CARD_WIDTH * 0.78, 120, 20, CARD_WIDTH * 0.78, 120, 820)
  glow.addColorStop(0, withAlpha(layout.accent, 0.16))
  glow.addColorStop(1, withAlpha(layout.accent, 0))
  context.fillStyle = glow
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
  drawGlobe(context, layout.path)
  drawMotif(context, layout.motif, layout.accent, layout.path)

  const fadeStart = Math.max(440, textTop - 170)
  const fade = context.createLinearGradient(0, fadeStart, 0, textTop + 40)
  fade.addColorStop(0, withAlpha(COLORS.midnight, 0))
  fade.addColorStop(1, withAlpha(COLORS.midnight, 0.94))
  context.fillStyle = fade
  context.fillRect(0, fadeStart, CARD_WIDTH, textTop + 40 - fadeStart)
  context.fillStyle = withAlpha(COLORS.midnight, 0.94)
  context.fillRect(0, textTop + 40, CARD_WIDTH, CARD_HEIGHT - textTop - 40)

  const top = context.createLinearGradient(0, 0, 0, 230)
  top.addColorStop(0, withAlpha(COLORS.midnight, 0.85))
  top.addColorStop(1, withAlpha(COLORS.midnight, 0))
  context.fillStyle = top
  context.fillRect(0, 0, CARD_WIDTH, 230)
}

function drawTopBar(context: Context, badge: string | null): void {
  const mark = context.createLinearGradient(MARGIN, 88, MARGIN + 34, 128)
  mark.addColorStop(0, COLORS.goldLight)
  mark.addColorStop(1, COLORS.gold)
  context.fillStyle = mark
  hexagonPath(context, MARGIN + 17, 108, 19)
  context.fill()
  setType(context, `800 30px ${SANS}`, COLORS.ink, 7)
  context.textBaseline = 'middle'
  context.fillText('NIM RELAY', MARGIN + 52, 110)
  if (badge) {
    setType(context, `750 22px ${SANS}`, '#BFF5FC', 3)
    const width = context.measureText(badge).width + 78
    const x = CARD_WIDTH - MARGIN - width
    context.fillStyle = 'rgba(34, 211, 238, 0.1)'
    context.strokeStyle = 'rgba(34, 211, 238, 0.4)'
    context.lineWidth = 2
    context.beginPath()
    context.roundRect(x, 82, width, 54, 27)
    context.fill()
    context.stroke()
    context.fillStyle = COLORS.cyan
    context.beginPath()
    context.arc(x + 30, 109, 7, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#BFF5FC'
    context.fillText(badge, x + 50, 110)
  }
  context.textBaseline = 'alphabetic'
}

/** The largest value size at which every stat fits its column. */
function statValueSize(context: Context, stats: readonly CardStat[], column: number): number {
  for (let size = 76; size > 40; size -= 4) {
    setType(context, `italic 850 ${size}px ${SANS}`, COLORS.ink)
    if (stats.every(stat => context.measureText(stat.value).width <= column - 36)) return size
  }
  return 40
}

function drawStats(context: Context, stats: readonly CardStat[], top: number): void {
  const column = CONTENT / stats.length
  const valueSize = statValueSize(context, stats, column)
  stats.forEach((stat, index) => {
    const x = MARGIN + index * column + (index > 0 ? 30 : 0)
    if (index > 0) {
      context.fillStyle = 'rgba(214, 226, 255, 0.14)'
      context.fillRect(MARGIN + index * column, top + 6, 2, 118)
    }
    setType(context, `italic 850 ${valueSize}px ${SANS}`, COLORS.ink)
    context.fillText(stat.value, x, top + 72)
    setType(context, `700 22px ${SANS}`, COLORS.mist, 4)
    context.fillText(fitText(context, stat.label, column - 40), x, top + 118)
  })
}

function drawLanes(context: Context, layout: CardLayout, top: number): void {
  if (layout.motif.kind !== 'lanes') return
  const { captains, scores, target, winner } = layout.motif
  const sides = [
    { color: COLORS.gold, name: captains[0], score: scores[0], won: winner === 'gold' },
    { color: COLORS.cyan, name: captains[1], score: scores[1], won: winner === 'cyan' },
  ]
  sides.forEach((side, index) => {
    const y = top + index * 66
    setType(context, `750 30px ${SANS}`, side.won ? side.color : COLORS.ink)
    context.fillText(fitText(context, `${side.name.toUpperCase()}${side.won ? ' · WON' : ''}`, 420), MARGIN, y + 30)
    const barX = MARGIN + 450
    const barWidth = CONTENT - 450 - 150
    context.fillStyle = 'rgba(214, 226, 255, 0.1)'
    context.beginPath()
    context.roundRect(barX, y + 12, barWidth, 16, 8)
    context.fill()
    context.fillStyle = side.color
    context.beginPath()
    context.roundRect(barX, y + 12, Math.max(16, barWidth * Math.min(1, target > 0 ? side.score / target : 0)), 16, 8)
    context.fill()
    setType(context, `italic 850 40px ${SANS}`, side.color)
    context.textAlign = 'right'
    context.fillText(`${side.score}/${target}`, CARD_WIDTH - MARGIN, y + 36)
    context.textAlign = 'left'
  })
}

function drawCard(context: Context, layout: CardLayout, url: string): void {
  const footerBaseline = CARD_HEIGHT - 84
  const urlBaseline = footerBaseline - 46
  const lanes = layout.motif.kind === 'lanes'
  const statsTop = lanes ? urlBaseline - 250 : layout.stats.length > 0 ? urlBaseline - 240 : urlBaseline - 60
  let cursor = statsTop - 40
  const detailBaseline = layout.detail ? cursor : null
  if (layout.detail) cursor -= 50
  const captionBaseline = layout.caption ? cursor : null
  if (layout.caption) cursor -= 60

  const face = displayFace(context)
  const headline = fitHeadline(face, layout.headline, cursor - HEADLINE_CEILING)
  const headlineTop = cursor - headline.lines.length * headline.lineHeight
  const kickerBaseline = headlineTop - 26

  drawBackdrop(context, layout, kickerBaseline - 40)
  drawTopBar(context, layout.badge)

  setType(context, `750 30px ${SANS}`, layout.accent === COLORS.gold ? COLORS.goldLight : layout.accent, 5)
  context.fillText(fitText(context, layout.kicker, CONTENT), MARGIN, kickerBaseline)

  context.fillStyle = COLORS.ink
  headline.lines.forEach((line, index) => {
    face.use(headline.size)
    face.fill(line, MARGIN, headlineTop + (index + 1) * headline.lineHeight - headline.size * 0.14)
  })

  if (layout.caption && captionBaseline !== null) {
    setType(context, `500 36px ${SANS}`, COLORS.inkSoft)
    context.fillText(fitText(context, layout.caption, CONTENT), MARGIN, captionBaseline)
  }
  if (layout.detail && detailBaseline !== null) {
    setType(context, `500 28px ${SANS}`, COLORS.mist)
    context.fillText(fitText(context, layout.detail, CONTENT), MARGIN, detailBaseline)
  }
  if (lanes) drawLanes(context, layout, statsTop + 40)
  else if (layout.stats.length > 0) drawStats(context, layout.stats, statsTop)

  context.fillStyle = 'rgba(214, 226, 255, 0.12)'
  context.fillRect(MARGIN, urlBaseline - 58, CONTENT, 2)
  setType(context, `650 30px ${SANS}`, COLORS.gold)
  context.fillText(fitText(context, url.replace(/^https?:\/\//, ''), CONTENT), MARGIN, urlBaseline)
  setType(context, `450 25px ${SANS}`, COLORS.mistDim)
  context.fillText(fitText(context, layout.footer, CONTENT), MARGIN, footerBaseline)
}

/** Draws the card at 1080 by 1350, the portrait size social feeds show uncropped, and exports a PNG. */
export async function renderCard(layout: CardLayout, url: string): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw localFailure('card_canvas_unavailable')
  drawCard(context, layout, url)
  return new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(localFailure('card_export_failed'))), 'image/png'))
}
