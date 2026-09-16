import type { RelayNetwork } from '@nim-relay/shared'
import type { DepartureRow, SignalTone } from '../../view-model'
import { DEPARTURE_ROWS } from '../../model/departures'
import { FONT, capBaseline, fitText, roundedRect, setFont } from '../display'
import { INK } from '../palette'

/** Logical canvas size; the board face is 3.7 x 2.25 m. */
export const BOARD_CANVAS = { width: 560, height: 340 } as const

const MARGIN = 16
const HEADER = 44
const FIRST_ROW = 66
const ROW_PITCH = 44
const TILE_HEIGHT = 34
const SERVICE = { x: MARGIN, width: 76 }
const JOURNEY = { x: 102, cells: 16, pitch: 17.5 }
const STATUS = { x: 390, width: 128 }
const LAMP_X = 538
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export interface BoardPaint {
  rows: readonly DepartureRow[]
  network: RelayNetwork
  /** Milliseconds into a Solari shuffle, or null for settled flaps. */
  shuffleMs: number | null
  /** Rows whose flaps should shuffle. */
  changed: ReadonlySet<number>
}

export const SHUFFLE_MS = 1100

export function paintBoard(context: CanvasRenderingContext2D, paint: BoardPaint): void {
  const { width, height } = BOARD_CANVAS
  context.fillStyle = INK.panel
  context.fillRect(0, 0, width, height)

  setFont(context, 29, FONT.sign)
  context.fillStyle = INK.gold
  context.textAlign = 'left'
  context.fillText('DEPARTURES', MARGIN, capBaseline(context, HEADER / 2 + 1))
  setFont(context, 15, FONT.sign)
  context.fillStyle = INK.muted
  context.textAlign = 'right'
  context.fillText(paint.network === 'MainAlbatross' ? 'NIMIQ MAINNET' : 'NIMIQ TESTNET', width - MARGIN, capBaseline(context, HEADER / 2 + 1))
  context.fillStyle = INK.panelEdge
  context.fillRect(MARGIN, HEADER, width - MARGIN * 2, 1)

  setFont(context, 11, FONT.sign)
  context.fillStyle = INK.muted
  context.textAlign = 'left'
  const labelY = capBaseline(context, HEADER + 11)
  context.fillText('SERVICE', SERVICE.x, labelY)
  context.fillText('JOURNEY', JOURNEY.x, labelY)
  context.fillText('STATUS', STATUS.x, labelY)

  for (let index = 0; index < DEPARTURE_ROWS; index++) {
    const top = FIRST_ROW + index * ROW_PITCH
    const row = paint.rows[index]
    const settle = paint.shuffleMs !== null && paint.changed.has(index) ? paint.shuffleMs : null
    paintRow(context, top, row ?? null, index, settle)
  }
}

function paintRow(context: CanvasRenderingContext2D, top: number, row: DepartureRow | null, index: number, shuffleMs: number | null): void {
  const wordSettled = shuffleMs === null || shuffleMs > 180 + index * 70
  tile(context, SERVICE.x, top, SERVICE.width)
  tile(context, STATUS.x, top, STATUS.width)
  if (row && wordSettled) {
    word(context, row.service.toLocaleUpperCase('en-US'), SERVICE.x, top, SERVICE.width, INK.muted)
    word(context, row.status.toLocaleUpperCase('en-US'), STATUS.x, top, STATUS.width, toneInk(row.tone))
  }

  const letters = row ? journeyLetters(row.destination) : []
  setFont(context, 25, FONT.sign)
  context.textAlign = 'center'
  const baseline = capBaseline(context, top + TILE_HEIGHT / 2 + 1)
  for (let cell = 0; cell < JOURNEY.cells; cell++) {
    const x = JOURNEY.x + cell * JOURNEY.pitch
    tile(context, x, top, JOURNEY.pitch - 2)
    const settled = shuffleMs === null || shuffleMs > 120 + cell * 34 + index * 55
    const letter = settled ? letters[cell] : shuffleGlyph(index, cell, shuffleMs)
    if (!letter || letter === ' ') continue
    context.fillStyle = INK.text
    context.fillText(letter, x + (JOURNEY.pitch - 2) / 2, baseline)
  }

  lamp(context, top, row && wordSettled ? row.tone : null)
}

/** Uppercase glyphs across the journey cells, with an ellipsis tile when the name runs long. */
function journeyLetters(destination: string): string[] {
  const glyphs = Array.from(destination.toLocaleUpperCase('en-US'))
  if (glyphs.length <= JOURNEY.cells) return glyphs
  return [...glyphs.slice(0, JOURNEY.cells - 1), '…']
}

function shuffleGlyph(row: number, cell: number, shuffleMs: number | null): string {
  const frame = Math.floor((shuffleMs ?? 0) / 70)
  const hash = Math.imul(row * 73856093 + cell * 19349663 + frame * 83492791, 2654435761) >>> 0
  return GLYPHS[hash % GLYPHS.length] ?? ''
}

function tile(context: CanvasRenderingContext2D, x: number, top: number, width: number): void {
  const half = TILE_HEIGHT / 2
  roundedRect(context, x, top, width, TILE_HEIGHT, 2.5)
  context.fillStyle = INK.flapBottom
  context.fill()
  roundedRect(context, x, top, width, half, 2.5)
  context.fillStyle = INK.flapTop
  context.fill()
  context.fillStyle = INK.hinge
  context.fillRect(x, top + half - 0.75, width, 1.5)
  context.fillStyle = 'rgba(255, 255, 255, 0.05)'
  context.fillRect(x + 1, top + 0.5, width - 2, 0.75)
}

function word(context: CanvasRenderingContext2D, text: string, x: number, top: number, width: number, color: string): void {
  if (!text) return
  setFont(context, 21, FONT.sign)
  context.textAlign = 'left'
  context.fillStyle = color
  context.fillText(fitText(context, text, width - 16), x + 8, capBaseline(context, top + TILE_HEIGHT / 2 + 1))
}

function lamp(context: CanvasRenderingContext2D, top: number, tone: SignalTone | null): void {
  const y = top + TILE_HEIGHT / 2
  if (tone === 'opportunity' || tone === 'live') {
    const color = tone === 'live' ? INK.cyan : INK.gold
    const glow = context.createRadialGradient(LAMP_X, y, 0, LAMP_X, y, 14)
    glow.addColorStop(0, tone === 'live' ? 'rgba(34, 211, 238, 0.55)' : 'rgba(245, 166, 35, 0.55)')
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
    context.fillStyle = glow
    context.fillRect(LAMP_X - 14, y - 14, 28, 28)
    context.beginPath()
    context.arc(LAMP_X, y, 5, 0, Math.PI * 2)
    context.fillStyle = color
    context.fill()
    return
  }
  context.beginPath()
  context.arc(LAMP_X, y, 4.5, 0, Math.PI * 2)
  context.strokeStyle = INK.faint
  context.lineWidth = 1.5
  context.stroke()
}

function toneInk(tone: SignalTone): string {
  if (tone === 'opportunity') return INK.gold
  if (tone === 'live') return INK.cyan
  return INK.text
}
