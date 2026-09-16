import * as THREE from 'three'
import type { StationViewData, WorldView } from '../../view-model'
import { FONT, capBaseline, createCanvasDisplay, createDisplayMaterial, setFont } from '../display'
import type { StationKit } from '../kit'
import { PLACEMENT, placeSurface } from '../layout'
import { COLOR, INK } from '../palette'
import { createGlassMaterial, createGlowMaterial } from '../shaders'
import type { StationSurface } from '../types'
import { approach, at, createHitTarget, focusFrame } from './common'
import { createGlobe } from './globe'

const WINDOW_RADIUS = 7.6
const WINDOW_ARC = 1.02
/** Distance from the window's axis to the surface origin. */
const AXIS_Z = 6.3
const WINDOW_BOTTOM = 1.25
const WINDOW_HEIGHT = 4.3
const SILL_HEIGHT = 1.15
const GLOBE_Y = 3.25
const GLOBE_Z = 0.1
const CAPTION = { width: 512, height: 72, meters: [3.4, 0.48] as const }

/** A tall curved window onto the city, with the Earth and its relay routes floating in front of it. */
export function createWorld(kit: StationKit, reducedMotion: () => boolean): StationSurface {
  const root = new THREE.Group()
  root.name = 'world'
  const surface = placeSurface('world', root)
  const { tag } = PLACEMENT.world

  const glass = new THREE.Mesh(
    kit.track(new THREE.CylinderGeometry(WINDOW_RADIUS, WINDOW_RADIUS, WINDOW_HEIGHT, 40, 1, true, Math.PI - WINDOW_ARC / 2, WINDOW_ARC)),
    kit.track(createGlassMaterial(kit.uniforms, new THREE.Color('#8fa6d6'), 0.8)),
  )
  glass.position.set(0, WINDOW_BOTTOM + WINDOW_HEIGHT / 2, AXIS_Z)
  root.add(glass)

  for (let i = 0; i <= 6; i++) {
    const angle = Math.PI - WINDOW_ARC / 2 + (WINDOW_ARC * i) / 6
    const x = Math.sin(angle) * WINDOW_RADIUS
    const z = AXIS_Z + Math.cos(angle) * WINDOW_RADIUS
    const width = i === 0 || i === 6 ? 0.22 : 0.07
    const mullion = new THREE.BoxGeometry(width, WINDOW_HEIGHT + 0.2, 0.12).rotateY(angle)
    kit.structure.add(mullion, at(surface, x, WINDOW_BOTTOM + WINDOW_HEIGHT / 2, z))
  }
  for (const [y, tube] of [
    [WINDOW_BOTTOM + WINDOW_HEIGHT + 0.1, 0.1],
    [WINDOW_BOTTOM - 0.02, 0.07],
  ] as const) {
    const rail = new THREE.TorusGeometry(WINDOW_RADIUS, tube, 5, 48, WINDOW_ARC).rotateX(Math.PI / 2).rotateY(Math.PI / 2 + WINDOW_ARC / 2)
    kit.structure.add(rail, at(surface, 0, y, AXIS_Z))
  }
  const lightArc = new THREE.TorusGeometry(WINDOW_RADIUS - 0.12, 0.018, 4, 64, WINDOW_ARC).rotateX(Math.PI / 2).rotateY(Math.PI / 2 + WINDOW_ARC / 2)
  kit.lights.add(lightArc, at(surface, 0, WINDOW_BOTTOM + WINDOW_HEIGHT - 0.04, AXIS_Z), tag)

  kit.stone.add(sillGeometry(), surface)
  kit.lights.add(new THREE.TorusGeometry(WINDOW_RADIUS - 0.37, 0.02, 4, 64, WINDOW_ARC).rotateX(Math.PI / 2).rotateY(Math.PI / 2 + WINDOW_ARC / 2), at(surface, 0, SILL_HEIGHT + 0.05, AXIS_Z), tag)

  const globe = createGlobe(kit)
  globe.object.position.set(0, GLOBE_Y, GLOBE_Z)
  root.add(globe.object)

  const beamHeight = GLOBE_Y - SILL_HEIGHT - 0.25 - 0.95
  const beam = new THREE.Mesh(
    kit.track(new THREE.ConeGeometry(0.95, beamHeight, 32, 1, true).rotateX(Math.PI)),
    kit.track(createGlowMaterial(kit.uniforms, { color: COLOR.lamp, strength: 0.2, falloff: 1.2 })),
  )
  beam.position.set(0, SILL_HEIGHT + 0.25 + beamHeight / 2, GLOBE_Z)
  root.add(beam)
  kit.structure.add(new THREE.CylinderGeometry(0.13, 0.2, SILL_HEIGHT + 0.2, 20), at(surface, 0, (SILL_HEIGHT + 0.2) / 2, GLOBE_Z))
  kit.structure.add(new THREE.CylinderGeometry(0.34, 0.3, 0.05, 32), at(surface, 0, SILL_HEIGHT + 0.22, GLOBE_Z))
  kit.lights.add(new THREE.TorusGeometry(0.3, 0.01, 4, 48).rotateX(Math.PI / 2), at(surface, 0, SILL_HEIGHT + 0.25, GLOBE_Z), tag)

  const signY = WINDOW_BOTTOM + WINDOW_HEIGHT + 0.46
  const signZ = AXIS_Z - WINDOW_RADIUS + 0.16
  kit.structure.add(new THREE.BoxGeometry(CAPTION.meters[0] + 0.24, CAPTION.meters[1] + 0.16, 0.12), at(surface, 0, signY, signZ - 0.07))
  const caption = kit.track(createCanvasDisplay(kit, CAPTION.width, CAPTION.height))
  const captionMesh = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(...CAPTION.meters)), createDisplayMaterial(kit, caption))
  captionMesh.position.set(0, signY, signZ)
  root.add(captionMesh)

  const hitTarget = createHitTarget(kit, root, [7.4, 6.4, 3.4], [0, 3.2, 0.2])
  const frame = focusFrame(root, [0, (GLOBE_Y - 1.3 + WINDOW_BOTTOM + WINDOW_HEIGHT + 0.7) / 2, GLOBE_Z], 3.5, WINDOW_HEIGHT + 0.2, { elevation: 0.1 })
  let glow = 0
  let glowTarget = 0

  return {
    id: 'world',
    root,
    hitTarget,
    frame,
    update(data: StationViewData) {
      const key = JSON.stringify(data.world)
      if (caption.paint(key, context => paintCaption(context, data.world))) globe.setRoutes(data.world.routes)
    },
    setFocused(focused) {
      glowTarget = focused ? 1 : 0
    },
    tick(time, delta) {
      glow = approach(glow, glowTarget, delta, 4)
      kit.setLightGlow(tag, glow)
      globe.tick(time, delta, reducedMotion())
    },
    dispose() {
      globe.dispose()
      root.removeFromParent()
    },
  }
}

/** A curved stone sill following the window, as a static batch part in surface space. */
function sillGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const inner = WINDOW_RADIUS - 0.35
  const outer = WINDOW_RADIUS + 0.45
  const half = (WINDOW_ARC * 1.04) / 2
  const steps = 24
  for (let i = 0; i <= steps; i++) {
    const angle = -half + (2 * half * i) / steps
    const x = Math.sin(angle) * inner
    const y = AXIS_Z - Math.cos(angle) * inner
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  for (let i = steps; i >= 0; i--) {
    const angle = -half + (2 * half * i) / steps
    shape.lineTo(Math.sin(angle) * outer, AXIS_Z - Math.cos(angle) * outer)
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: SILL_HEIGHT, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 })
  return geometry.rotateX(Math.PI / 2).translate(0, SILL_HEIGHT, 0)
}

function paintCaption(context: CanvasRenderingContext2D, world: WorldView): void {
  const { width, height } = CAPTION
  context.fillStyle = INK.panel
  context.fillRect(0, 0, width, height)
  context.fillStyle = INK.panelEdge
  context.fillRect(0, 0, width, 1)
  const middle = height / 2
  setFont(context, 26, FONT.sign)
  context.textAlign = 'left'
  context.fillStyle = INK.gold
  context.fillText('WORLD ROUTES', 18, capBaseline(context, middle))

  context.textAlign = 'right'
  if (world.activeRelays === 0) {
    setFont(context, 22, FONT.sign)
    context.fillStyle = INK.muted
    context.fillText('NO ACTIVE RELAYS YET', width - 18, capBaseline(context, middle))
    return
  }
  const stats: [string, string][] = [
    [String(world.countries), world.countries === 1 ? 'COUNTRY' : 'COUNTRIES'],
    [String(world.activeRelays), world.activeRelays === 1 ? 'ACTIVE RELAY' : 'ACTIVE RELAYS'],
  ]
  let right = width - 18
  for (const [value, label] of stats) {
    setFont(context, 17, FONT.sign)
    context.fillStyle = INK.muted
    context.fillText(label, right, capBaseline(context, middle))
    right -= context.measureText(label).width + 8
    setFont(context, 28, FONT.figure)
    context.fillStyle = INK.text
    context.fillText(value, right, capBaseline(context, middle))
    right -= context.measureText(value).width + 22
  }
}
