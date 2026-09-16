import { CARD_WIDTH, COLORS, drawBaton, hexagonPath, quadraticPoint, seededRandom, withAlpha, type Context, type Point } from './canvas-kit'
import type { CardMotif } from './layout'

/** The world home's globe, seen from above the relay, rising behind every card. */
const GLOBE = { x: CARD_WIDTH / 2, y: 540, radius: 470 }

export function drawGlobe(context: Context, seed: string): void {
  const { x, y, radius } = GLOBE
  const atmosphere = context.createRadialGradient(x, y, radius * 0.92, x, y, radius * 1.22)
  atmosphere.addColorStop(0, 'rgba(92, 130, 255, 0.22)')
  atmosphere.addColorStop(1, 'rgba(92, 130, 255, 0)')
  context.fillStyle = atmosphere
  context.fillRect(x - radius * 1.3, y - radius * 1.3, radius * 2.6, radius * 2.6)

  const body = context.createRadialGradient(x - radius * 0.35, y - radius * 0.45, radius * 0.1, x, y, radius)
  body.addColorStop(0, '#1d2b50')
  body.addColorStop(0.55, '#101a33')
  body.addColorStop(1, '#080d1b')
  context.fillStyle = body
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.fill()

  context.save()
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.clip()
  context.strokeStyle = 'rgba(170, 196, 255, 0.13)'
  context.lineWidth = 2
  context.setLineDash([2, 12])
  const tilt = 0.38
  for (const latitude of [-60, -30, 0, 30, 60]) {
    const phi = (latitude * Math.PI) / 180
    context.beginPath()
    context.ellipse(x, y - radius * Math.sin(phi) * Math.cos(tilt), radius * Math.cos(phi), radius * Math.cos(phi) * Math.sin(tilt), 0, 0, Math.PI * 2)
    context.stroke()
  }
  for (const longitude of [15, 45, 75]) {
    const width = radius * Math.sin((longitude * Math.PI) / 180)
    context.beginPath()
    context.ellipse(x, y, width, radius, 0, 0, Math.PI * 2)
    context.stroke()
  }
  context.setLineDash([])
  const random = seededRandom(seed)
  for (let light = 0; light < 46; light++) {
    const angle = random() * Math.PI * 2
    const distance = Math.sqrt(random()) * radius * 0.92
    context.fillStyle = withAlpha(COLORS.goldLight, 0.18 + random() * 0.4)
    context.beginPath()
    context.arc(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance * 0.9, 1.5 + random() * 2.2, 0, Math.PI * 2)
    context.fill()
  }
  context.restore()

  const rim = context.createLinearGradient(x - radius, y - radius, x + radius, y + radius)
  rim.addColorStop(0, 'rgba(150, 180, 255, 0.55)')
  rim.addColorStop(0.6, 'rgba(150, 180, 255, 0.12)')
  rim.addColorStop(1, 'rgba(150, 180, 255, 0.04)')
  context.strokeStyle = rim
  context.lineWidth = 2.5
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.stroke()
}

/** A tapering light trail along a quadratic curve, brightest at its head. */
function trail(context: Context, from: Point, control: Point, to: Point, color: string, width: number): void {
  const steps = 48
  context.lineCap = 'round'
  for (let step = 0; step < steps; step++) {
    const [ax, ay] = quadraticPoint(from, control, to, step / steps)
    const [bx, by] = quadraticPoint(from, control, to, (step + 1) / steps)
    const t = (step + 1) / steps
    context.strokeStyle = withAlpha(color, 0.06 + t * 0.88)
    context.lineWidth = 1 + width * t
    context.beginPath()
    context.moveTo(ax, ay)
    context.lineTo(bx, by)
    context.stroke()
  }
}

function dashedArc(context: Context, from: Point, control: Point, to: Point, color: string): void {
  context.strokeStyle = withAlpha(color, 0.8)
  context.lineWidth = 4
  context.lineCap = 'butt'
  context.setLineDash([14, 14])
  context.beginPath()
  context.moveTo(...from)
  context.quadraticCurveTo(...control, ...to)
  context.stroke()
  context.setLineDash([])
}

function stop(context: Context, [x, y]: Point, color: string): void {
  const halo = context.createRadialGradient(x, y, 4, x, y, 44)
  halo.addColorStop(0, withAlpha(color, 0.45))
  halo.addColorStop(1, withAlpha(color, 0))
  context.fillStyle = halo
  context.fillRect(x - 44, y - 44, 88, 88)
  context.fillStyle = COLORS.goldLight
  context.beginPath()
  context.arc(x, y, 12, 0, Math.PI * 2)
  context.fill()
}

/** A kept streak day: the crew color as a faceted hexagon, brighter toward today. */
function streakCell(context: Context, x: number, y: number, radius: number, color: string, strength: number): void {
  const body = context.createLinearGradient(x - radius, y - radius, x + radius, y + radius)
  body.addColorStop(0, withAlpha(color, 0.35 + strength * 0.5))
  body.addColorStop(1, withAlpha(color, 0.12 + strength * 0.35))
  context.fillStyle = body
  hexagonPath(context, x, y, radius)
  context.fill()
  context.strokeStyle = withAlpha(color, 0.5 + strength * 0.4)
  context.lineWidth = 2
  hexagonPath(context, x, y, radius)
  context.stroke()
}

/** Motifs sit in the globe's upper half, above the tallest headline the frame allows. */
export function drawMotif(context: Context, motif: CardMotif, accent: string, seed: string): void {
  switch (motif.kind) {
    case 'comet':
      trail(context, [110, 700], [360, 110], [800, 330], accent, 14)
      drawBaton(context, 800, 330, 58, accent)
      return
    case 'pass': {
      const from: Point = [210, 440]
      const control: Point = [540, 20]
      const to: Point = [870, 380]
      dashedArc(context, from, control, to, accent)
      stop(context, from, accent)
      stop(context, to, accent)
      const [x, y] = quadraticPoint(from, control, to, 0.62)
      drawBaton(context, x, y, 50, accent)
      return
    }
    case 'chain': {
      const cells = 7
      const kept = Math.min(cells, motif.filled)
      for (let cell = 0; cell < cells; cell++) {
        const x = GLOBE.x + (cell - (cells - 1) / 2) * 122
        const y = 360
        if (cell === cells - 1 && kept > 0) drawBaton(context, x, y, 52, accent)
        else if (cell >= cells - kept) streakCell(context, x, y, 46, accent, cell / (cells - 1))
        else {
          context.strokeStyle = withAlpha(accent, 0.3)
          context.lineWidth = 3
          context.setLineDash([8, 8])
          hexagonPath(context, x, y, 46)
          context.stroke()
          context.setLineDash([])
        }
      }
      return
    }
    case 'rings': {
      for (const [index, radius] of [104, 186, 268, 350].entries()) {
        context.strokeStyle = withAlpha(accent, 0.46 - index * 0.1)
        context.lineWidth = 3
        context.beginPath()
        context.arc(GLOBE.x, 360, radius, 0, Math.PI * 2)
        context.stroke()
      }
      drawBaton(context, GLOBE.x, 360, 66, accent)
      return
    }
    case 'route': {
      const random = seededRandom(`${seed}-route`)
      const count = Math.min(7, Math.max(2, motif.stops))
      const points = Array.from({ length: count }, (_, index): Point => {
        const progress = index / (count - 1)
        return [180 + 720 * progress, 480 - progress * 230 - Math.sin(progress * Math.PI) * 110 + (random() - 0.5) * 50]
      })
      points.slice(1).forEach((point, index) => {
        const previous = points[index] ?? point
        dashedArc(context, previous, [(previous[0] + point[0]) / 2, Math.min(previous[1], point[1]) - 80], point, accent)
      })
      points.slice(0, -1).forEach(point => stop(context, point, accent))
      const head = points.at(-1)
      if (head) drawBaton(context, head[0], head[1], 50, accent)
      return
    }
    case 'lanes': {
      const lanes: [string, number][] = [
        [COLORS.gold, motif.scores[0]],
        [COLORS.cyan, motif.scores[1]],
      ]
      lanes.forEach(([color, score], index) => {
        const radiusX = 430 - index * 90
        const radiusY = 170 - index * 38
        const progress = motif.target > 0 ? Math.min(1, score / motif.target) : 0
        context.lineCap = 'round'
        context.lineWidth = 16
        context.strokeStyle = withAlpha(color, 0.18)
        context.beginPath()
        context.ellipse(GLOBE.x, 470, radiusX, radiusY, 0, Math.PI, Math.PI * 2)
        context.stroke()
        context.strokeStyle = color
        context.beginPath()
        context.ellipse(GLOBE.x, 470, radiusX, radiusY, 0, Math.PI, Math.PI + Math.PI * progress)
        context.stroke()
        const angle = Math.PI + Math.PI * progress
        drawBaton(context, GLOBE.x + radiusX * Math.cos(angle), 470 + radiusY * Math.sin(angle), 36, color)
      })
      return
    }
  }
}
