import * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'
import { MeshBuilder } from '../mesh-builder'
import { fromQ, type Route, type RouteFork } from '../route'
import { GOLD } from '../track-style'
import { edgeLateral } from './kit'

/**
 * Diegetic road signs. The few words the route needs are drawn once into a
 * canvas atlas that also carries a solid cell; every sign on the route, posts
 * and panels included, is merged into one unlit mesh built at mount, one draw
 * call. Forks get an overhead gantry that names each path over the lanes that
 * choose it; world events get a roadside warning before they trigger.
 */

export type SignWord =
  | 'RELAY CUT'
  | 'SHORTCUT'
  | 'SAFE LOOP'
  | 'LANE CLOSED'
  | 'CROSSWIND'
  | 'TRAM CROSSING'
  | 'WORKS AHEAD'
  | 'DRONE SWEEP'
  | 'PULSE 144'
  | 'BRIDGE LIFT'
  | 'BRIDGE OUT'

const WORDS: readonly SignWord[] = ['RELAY CUT', 'SHORTCUT', 'SAFE LOOP', 'LANE CLOSED', 'CROSSWIND', 'TRAM CROSSING', 'WORKS AHEAD', 'DRONE SWEEP', 'PULSE 144', 'BRIDGE LIFT', 'BRIDGE OUT']
const ATLAS_WIDTH = 1024
const ROW = 84
const FONT = '800 56px Inter, "Helvetica Neue", Arial, sans-serif'
const GANTRY_LEAD = 85
/** The sign gantry reaches past both road edges, so each path's name can span its lanes and more. */
const GANTRY_OVERHANG = 2.6
const GANTRY_HEIGHT = 7
const WARNING_LEAD = 18

const EVENT_WORDS: Readonly<Partial<Record<relayLeg.WorldEventKind, SignWord>>> = {
  'lane-closure': 'LANE CLOSED',
  crosswind: 'CROSSWIND',
  'transit-crossing': 'TRAM CROSSING',
  'maintenance-drone': 'WORKS AHEAD',
  'drone-pattern': 'DRONE SWEEP',
  'pulse-tunnel': 'PULSE 144',
  'rising-bridge': 'BRIDGE LIFT',
  'bridge-break': 'BRIDGE OUT',
}

interface Glyph {
  u0: number
  u1: number
  v0: number
  v1: number
  aspect: number
}

function createAtlas(): { texture: THREE.CanvasTexture; glyphs: Map<SignWord | 'solid', Glyph> } {
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_WIDTH
  canvas.height = ROW * (WORDS.length + 1)
  const glyphs = new Map<SignWord | 'solid', Glyph>()
  const context = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  if (!context) return { texture, glyphs }
  context.fillStyle = '#ffffff'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.font = FONT
  context.letterSpacing = '6px'
  WORDS.forEach((word, row) => {
    const width = Math.min(ATLAS_WIDTH - 16, context.measureText(word).width + 24)
    context.fillText(word, ATLAS_WIDTH / 2, row * ROW + ROW / 2 + 3)
    glyphs.set(word, {
      u0: (ATLAS_WIDTH / 2 - width / 2) / ATLAS_WIDTH,
      u1: (ATLAS_WIDTH / 2 + width / 2) / ATLAS_WIDTH,
      v0: 1 - ((row + 1) * ROW - 6) / canvas.height,
      v1: 1 - (row * ROW + 6) / canvas.height,
      aspect: width / (ROW - 12),
    })
  })
  const solidRow = WORDS.length
  context.fillRect(8, solidRow * ROW + 8, 64, ROW - 16)
  glyphs.set('solid', { u0: 12 / ATLAS_WIDTH, u1: 68 / ATLAS_WIDTH, v0: 1 - ((solidRow + 1) * ROW - 12) / canvas.height, v1: 1 - (solidRow * ROW + 12) / canvas.height, aspect: 1 })
  texture.needsUpdate = true
  return { texture, glyphs }
}

export interface Signage {
  group: THREE.Group
  dispose(): void
}

export function createSignage(route: Route): Signage {
  const group = new THREE.Group()
  group.name = 'signage'
  const { texture, glyphs } = createAtlas()
  const faces = new MeshBuilder()
  const solid = glyphs.get('solid')
  const steel = new THREE.Color('#1a1c22')
  const panel = new THREE.Color('#0c0d12')
  const white = new THREE.Color(1.5, 1.45, 1.35)
  const amber = new THREE.Color(2.6, 1.25, 0.16)
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const

  /** A quad facing an approaching courier at distance `d`, from lateral `left` to `right` and `bottom` to `top`. */
  const facing = (builder: MeshBuilder, d: number, left: number, right: number, bottom: number, top: number, color: THREE.Color, glyph?: Glyph): void => {
    builder.quad(route.point(d, left, bottom, p[0]), route.point(d, right, bottom, p[1]), route.point(d, right, top, p[2]), route.point(d, left, top, p[3]), color, glyph ? [glyph.u0, glyph.v0, glyph.u1, glyph.v1] : [0, 0, 0, 0])
  }
  /** A box on the route frame at `d`, `across` wide, from `bottom` up by `up`, `along` deep, drawn with the atlas's solid cell. */
  const box = (d: number, lateral: number, bottom: number, across: number, up: number, along: number): void => {
    const near = d - along / 2
    const far = d + along / 2
    const left = lateral - across / 2
    const right = lateral + across / 2
    const top = bottom + up
    const uv: readonly [number, number, number, number] = solid ? [solid.u0, solid.v0, solid.u1, solid.v1] : [0, 0, 0, 0]
    const quad = (a: readonly [number, number, number], b: readonly [number, number, number], c: readonly [number, number, number], e: readonly [number, number, number]): void => {
      faces.quad(route.point(a[0], a[1], a[2], p[0]), route.point(b[0], b[1], b[2], p[1]), route.point(c[0], c[1], c[2], p[2]), route.point(e[0], e[1], e[2], p[3]), steel, uv)
    }
    quad([near, left, bottom], [near, right, bottom], [near, right, top], [near, left, top])
    quad([far, right, bottom], [far, left, bottom], [far, left, top], [far, right, top])
    quad([far, left, bottom], [near, left, bottom], [near, left, top], [far, left, top])
    quad([near, right, bottom], [far, right, bottom], [far, right, top], [near, right, top])
    quad([near, left, top], [near, right, top], [far, right, top], [far, left, top])
  }
  const post = (d: number, lateral: number, top: number, half: number): void => box(d, lateral, -0.2, half * 2, top + 0.2, half * 2)
  const word = (d: number, centre: number, height: number, text: SignWord, color: THREE.Color, maxWidth: number): number => {
    const glyph = glyphs.get(text)
    if (!glyph) return 0
    const tall = Math.min(1.05, maxWidth / glyph.aspect)
    const wide = tall * glyph.aspect
    facing(faces, d, centre - wide / 2, centre + wide / 2, height - tall / 2, height + tall / 2, color, glyph)
    return wide
  }
  const arrow = (d: number, x: number, height: number, direction: -1 | 1, color: THREE.Color): void => {
    const solid = glyphs.get('solid')
    if (!solid) return
    const uv: readonly [number, number, number, number] = [solid.u0, solid.v0, solid.u1, solid.v1]
    const s = 0.34
    faces.quad(route.point(d, x - s, height - s, p[0]), route.point(d, x + s, height - s, p[1]), route.point(d, x + s + direction * 0.5, height + s * 0.2, p[2]), route.point(d, x - s + direction * 0.5, height + s * 0.2, p[3]), color, uv)
    faces.quad(route.point(d, x - s * 1.2 + direction * 0.5, height + s * 0.2, p[0]), route.point(d, x + s * 1.2 + direction * 0.5, height + s * 0.2, p[1]), route.point(d, x + direction * 0.5 + direction * 0.02, height + s * 1.1, p[2]), route.point(d, x + direction * 0.5, height + s * 1.1, p[3]), color, uv)
  }

  for (const fork of route.forks) forkGantry(fork)
  for (const event of route.track.events) eventWarning(event)

  function forkGantry(fork: RouteFork): void {
    const d = fork.from - GANTRY_LEAD
    const lanes = route.lanes('main', d)
    const left = edgeLateral(route, 'main', d, -1) - GANTRY_OVERHANG
    const right = edgeLateral(route, 'main', d, 1) + GANTRY_OVERHANG
    post(d, left, GANTRY_HEIGHT + 0.3, 0.22)
    post(d, right, GANTRY_HEIGHT + 0.3, 0.22)
    box(d, (left + right) / 2, GANTRY_HEIGHT - 0.2, right - left, 0.5, 0.4)
    const riskLanes = (lanes.count % 2 === 1 ? (lanes.count - 1) / 2 : lanes.count / 2) * lanes.width
    const split = fork.riskSide * (lanes.count % 2 === 1 ? lanes.width / 2 : 0)
    const riskFrom = fork.riskSide === 1 ? split : split - riskLanes
    const riskTo = fork.riskSide === 1 ? split + riskLanes : split
    const safeFrom = fork.riskSide === 1 ? left + 0.4 : riskTo
    const safeTo = fork.riskSide === 1 ? riskFrom : right - 0.4
    const signs: readonly [number, number, SignWord, THREE.Color][] = [
      [fork.riskSide === 1 ? riskFrom : left + 0.4, fork.riskSide === 1 ? right - 0.4 : riskTo, fork.label === 'relay-cut' ? 'RELAY CUT' : 'SHORTCUT', GOLD.bright],
      [safeFrom, safeTo, 'SAFE LOOP', white],
    ]
    for (const [from, to, text, color] of signs) {
      const inset = 0.15
      facing(faces, d - 0.3, from + inset, to - inset, GANTRY_HEIGHT - 2.2, GANTRY_HEIGHT - 0.2, panel, solid)
      const centre = (from + to) / 2
      const direction: -1 | 1 = text === 'SAFE LOOP' ? (fork.riskSide === 1 ? -1 : 1) : fork.riskSide
      word(d - 0.33, centre, GANTRY_HEIGHT - 0.82, text, color, to - from - 0.6)
      arrow(d - 0.33, centre, GANTRY_HEIGHT - 1.75, direction, color)
    }
  }

  function eventWarning(event: relayLeg.WorldEvent): void {
    const text = EVENT_WORDS[event.kind]
    if (!text) return
    const d = fromQ(event.triggerDist) - WARNING_LEAD
    const path = route.activePath(event.path, d)
    const side: -1 | 1 = event.lanes.length > 0 && (event.lanes[0] ?? 0) < 0 && event.kind === 'lane-closure' ? -1 : 1
    const lateral = edgeLateral(route, path, d, side) + side * 1.4
    post(d, lateral, 3.4, 0.08)
    facing(faces, d - 0.1, lateral - 1.9, lateral + 1.9, 2.35, 3.45, panel, solid)
    word(d - 0.13, lateral, 2.9, text, amber, 3.4)
  }

  const faceGeometry = faces.build()
  const faceMaterial = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, alphaTest: 0.35 })
  group.add(new THREE.Mesh(faceGeometry, faceMaterial))
  return {
    group,
    dispose() {
      group.removeFromParent()
      faceGeometry.dispose()
      faceMaterial.dispose()
      texture.dispose()
    },
  }
}
