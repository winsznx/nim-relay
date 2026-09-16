import * as THREE from 'three'
import type { ChronicleEntry, ChronicleView, StationViewData } from '../../view-model'
import { FONT, capBaseline, createCanvasDisplay, createDisplayMaterial, fitText, setFont } from '../display'
import type { StationKit } from '../kit'
import { PLACEMENT, placeSurface } from '../layout'
import { INK } from '../palette'
import { createRandom } from '../random'
import type { StationSurface } from '../types'
import { approach, at, createHitTarget, focusFrame, roundedSlab } from './common'

const WALL = { width: 2.95, height: 1.7, depth: 0.42 }
const FACE = { width: 2.64, height: 1.44, y: 0.98 }
const CANVAS = { width: 512, height: 280 }
const GAP = 10
const PADDING = 14

/** A stone memorial wall: four engraved panels holding achievements and recorded moments. */
export function createChronicle(kit: StationKit): StationSurface {
  const root = new THREE.Group()
  root.name = 'chronicle'
  const surface = placeSurface('chronicle', root)
  const { tag } = PLACEMENT.chronicle

  kit.stone.add(roundedSlab(WALL.width, WALL.height, WALL.depth, 0.05, 0.03), at(surface, 0, WALL.height / 2 + 0.12, 0))
  kit.stone.add(new THREE.BoxGeometry(WALL.width + 0.5, 0.12, WALL.depth + 0.5), at(surface, 0, 0.06, 0))
  kit.stone.add(new THREE.BoxGeometry(WALL.width + 0.2, 0.09, WALL.depth + 0.16), at(surface, 0, WALL.height + 0.165, 0))
  kit.lights.add(new THREE.BoxGeometry(WALL.width + 0.1, 0.018, 0.018), at(surface, 0, WALL.height + 0.115, WALL.depth / 2 + 0.05), tag)
  kit.lights.add(new THREE.BoxGeometry(WALL.width + 0.4, 0.016, 0.016), at(surface, 0, 0.125, WALL.depth / 2 + 0.24), tag)

  const display = kit.track(createCanvasDisplay(kit, CANVAS.width, CANVAS.height))
  const face = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(FACE.width, FACE.height)), createDisplayMaterial(kit, display))
  face.position.set(0, FACE.y, WALL.depth / 2 + 0.004)
  root.add(face)

  const hitTarget = createHitTarget(kit, root, [WALL.width + 1.2, WALL.height + 0.8, 2.2], [0, (WALL.height + 0.8) / 2, 0.5])
  const frame = focusFrame(root, [0, FACE.y, WALL.depth / 2], FACE.width + 0.2, FACE.height + 0.2, { elevation: 0.78 })
  let glow = 0
  let glowTarget = 0

  return {
    id: 'chronicle',
    root,
    hitTarget,
    frame,
    update(data: StationViewData) {
      display.paint(JSON.stringify([data.signedIn, data.chronicle]), context => paintWall(context, data.chronicle, data.signedIn))
    },
    setFocused(focused) {
      glowTarget = focused ? 1 : 0
    },
    tick(_time, delta) {
      glow = approach(glow, glowTarget, delta, 4)
      kit.setLightGlow(tag, glow)
    },
    dispose() {
      root.removeFromParent()
    },
  }
}

function paintWall(context: CanvasRenderingContext2D, chronicle: ChronicleView, signedIn: boolean): void {
  const { width, height } = CANVAS
  paintStone(context, width, height)
  const panelWidth = (width - PADDING * 2 - GAP) / 2
  const panelHeight = (height - PADDING * 2 - GAP) / 2
  const origins: [number, number][] = [
    [PADDING, PADDING],
    [PADDING + panelWidth + GAP, PADDING],
    [PADDING, PADDING + panelHeight + GAP],
    [PADDING + panelWidth + GAP, PADDING + panelHeight + GAP],
  ]
  origins.forEach(([x, y]) => recess(context, x, y, panelWidth, panelHeight))

  const [first = [PADDING, PADDING]] = origins
  paintAchievements(context, first[0], first[1], panelWidth, chronicle.achievements, signedIn)
  for (let index = 1; index < origins.length; index++) {
    const [x = 0, y = 0] = origins[index] ?? []
    paintMoment(context, x, y, panelWidth, panelHeight, chronicle.moments[index - 1] ?? null)
  }
}

/** Dark stone with a faint, fixed grain. */
function paintStone(context: CanvasRenderingContext2D, width: number, height: number): void {
  const gradient = context.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, '#26272c')
  gradient.addColorStop(1, '#1b1c21')
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)
  const random = createRandom(5)
  for (let i = 0; i < 1400; i++) {
    context.fillStyle = random() > 0.5 ? 'rgba(255, 248, 235, 0.03)' : 'rgba(0, 0, 0, 0.16)'
    context.fillRect(random() * width, random() * height, 1 + random() * 2, 1)
  }
}

function recess(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
  context.fillStyle = 'rgba(0, 0, 0, 0.22)'
  context.fillRect(x, y, width, height)
  context.fillStyle = 'rgba(0, 0, 0, 0.5)'
  context.fillRect(x, y, width, 2)
  context.fillRect(x, y, 2, height)
  context.fillStyle = 'rgba(255, 236, 200, 0.07)'
  context.fillRect(x, y + height - 1, width, 1)
  context.fillRect(x + width - 1, y, 1, height)
}

/** Text cut into stone: a shadow above, a catch of light below. */
function engrave(context: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  context.fillStyle = 'rgba(0, 0, 0, 0.7)'
  context.fillText(text, x, y - 1)
  context.fillStyle = 'rgba(255, 236, 200, 0.08)'
  context.fillText(text, x, y + 1)
  context.fillStyle = color
  context.fillText(text, x, y)
}

function paintAchievements(context: CanvasRenderingContext2D, x: number, y: number, width: number, achievements: readonly string[], signedIn: boolean): void {
  context.textAlign = 'left'
  setFont(context, 15, FONT.sign)
  engrave(context, 'ACHIEVEMENTS', x + 14, capBaseline(context, y + 20), INK.gold)
  if (achievements.length === 0) {
    setFont(context, 17, FONT.sign)
    engrave(context, signedIn ? 'NONE ENGRAVED YET' : 'SET UP A COURIER TO EARN THEM', x + 14, capBaseline(context, y + 58), INK.faint)
    return
  }
  achievements.slice(0, 3).forEach((achievement, index) => {
    const rowY = y + 50 + index * 30
    hexMark(context, x + 22, rowY)
    setFont(context, 19, FONT.sign)
    engrave(context, fitText(context, achievement.toLocaleUpperCase('en-US'), width - 56), x + 38, capBaseline(context, rowY), '#e9dcc2')
  })
}

function paintMoment(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, moment: ChronicleEntry | null): void {
  context.textAlign = 'left'
  if (!moment) {
    setFont(context, 15, FONT.sign)
    engrave(context, 'AWAITING A MOMENT', x + 14, capBaseline(context, y + height / 2), INK.faint)
    return
  }
  setFont(context, 15, FONT.sign)
  engrave(context, fitText(context, moment.heading.toLocaleUpperCase('en-US'), width - 28), x + 14, capBaseline(context, y + 20), INK.gold)
  setFont(context, 19, FONT.sign)
  const lines = wrap(context, moment.detail.toLocaleUpperCase('en-US'), width - 28, 3)
  lines.forEach((line, index) => engrave(context, line, x + 14, capBaseline(context, y + 52 + index * 26), '#e9dcc2'))
}

function hexMark(context: CanvasRenderingContext2D, cx: number, cy: number): void {
  context.beginPath()
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 6 + (i * Math.PI) / 3
    const px = cx + Math.cos(angle) * 7
    const py = cy + Math.sin(angle) * 7
    if (i === 0) context.moveTo(px, py)
    else context.lineTo(px, py)
  }
  context.closePath()
  context.strokeStyle = INK.gold
  context.lineWidth = 1.5
  context.stroke()
}

/** Greedy word wrap with an ellipsis on the last line. */
function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word
    if (context.measureText(candidate).width <= maxWidth || !current) {
      current = candidate
      continue
    }
    lines.push(current)
    current = word
    if (lines.length === maxLines) break
  }
  if (lines.length < maxLines && current) lines.push(current)
  const overflow = lines.length === maxLines && lines.join(' ').length < text.length
  return lines.map((line, index) => (index === lines.length - 1 && overflow ? fitText(context, `${line}…`, maxWidth) : fitText(context, line, maxWidth)))
}
