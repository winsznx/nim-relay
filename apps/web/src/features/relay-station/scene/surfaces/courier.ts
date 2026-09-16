import * as THREE from 'three'
import type { CourierView, StationViewData } from '../../view-model'
import { FONT, createCanvasDisplay, setFont } from '../display'
import type { StationKit } from '../kit'
import { PLACEMENT, placeSurface } from '../layout'
import { INK } from '../palette'
import type { StationSurface } from '../types'
import { approach, at, createHitTarget, focusFrame } from './common'
import { createCourierFigure } from './courier-figure'

const PAD_RADIUS = 1.32
const FULL_TURN = Math.PI * 2
const PAD_TOP = 0.23
const RING = { inner: 1.62, outer: 2.02, canvas: 384 }

/** The player's courier on a slowly turning pad, their name inscribed in the floor around it. */
export function createCourierBay(kit: StationKit, reducedMotion: () => boolean): StationSurface {
  const root = new THREE.Group()
  root.name = 'courier-bay'
  const surface = placeSurface('courier', root)
  const { tag } = PLACEMENT.courier

  kit.structure.add(new THREE.CylinderGeometry(PAD_RADIUS + 0.12, PAD_RADIUS + 0.24, 0.2, 64), at(surface, 0, 0.1, 0))
  kit.lights.add(new THREE.TorusGeometry(PAD_RADIUS + 0.1, 0.022, 4, 128).rotateX(Math.PI / 2), at(surface, 0, 0.205, 0), tag)
  kit.lights.add(new THREE.TorusGeometry(RING.outer + 0.06, 0.012, 3, 128).rotateX(Math.PI / 2), at(surface, 0, 0.012, 0), tag)

  const turntable = new THREE.Group()
  turntable.position.y = PAD_TOP
  root.add(turntable)

  const padMaterial = kit.track(new THREE.MeshStandardMaterial({ color: '#0d1119', roughness: 0.22, metalness: 0.75, emissive: '#ffffff', emissiveIntensity: 0.6 }))
  padMaterial.emissiveMap = kit.track(padPattern())
  const pad = new THREE.Mesh(kit.track(new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS, 0.04, 96)), padMaterial)
  pad.position.y = -0.02
  pad.receiveShadow = kit.settings.shadows
  turntable.add(pad)

  const contact = new THREE.Mesh(
    kit.track(new THREE.PlaneGeometry(1.3, 1.9).rotateX(-Math.PI / 2)),
    kit.track(new THREE.MeshBasicMaterial({ map: kit.radial, color: '#000000', transparent: true, opacity: 0.7, depthWrite: false })),
  )
  contact.position.y = 0.003
  turntable.add(contact)

  const figure = createCourierFigure(kit)
  figure.object.position.y = 0.08
  turntable.add(figure.object)

  const inscription = kit.track(createCanvasDisplay(kit, RING.canvas, RING.canvas))
  const ring = new THREE.Mesh(
    kit.track(new THREE.RingGeometry(RING.inner, RING.outer, 128, 1).rotateX(-Math.PI / 2)),
    kit.track(new THREE.MeshBasicMaterial({ map: inscription.texture, transparent: true, depthWrite: false, toneMapped: false })),
  )
  ring.position.y = 0.01
  root.add(ring)

  const hitTarget = createHitTarget(kit, root, [3.8, 2.6, 3.8], [0, 1.2, 0])
  const frame = focusFrame(root, [0, 1.0, 0], 2.9, 2.5, { elevation: 0.34 })
  let glow = 0
  let glowTarget = 0

  return {
    id: 'courier',
    root,
    hitTarget,
    frame,
    update(data: StationViewData) {
      const key = JSON.stringify(data.courier)
      inscription.paint(key, context => paintInscription(context, data.courier))
      figure.setLook(data.courier.equipped, data.courier.carrying)
    },
    setFocused(focused) {
      glowTarget = focused ? 1 : 0
    },
    tick(time, delta) {
      glow = approach(glow, glowTarget, delta, 4)
      kit.setLightGlow(tag, glow)
      if (glowTarget > 0) {
        const facing = Math.round(turntable.rotation.y / FULL_TURN) * FULL_TURN
        const sway = reducedMotion() ? 0 : Math.sin(time * 0.3) * 0.28
        turntable.rotation.y = approach(turntable.rotation.y, facing + sway, delta, 2.2)
      } else {
        turntable.rotation.y += delta * (reducedMotion() ? 0.05 : 0.22)
      }
      figure.tick(time, delta)
    },
    dispose() {
      figure.dispose()
      root.removeFromParent()
    },
  }
}

/** Concentric rings and ticks, painted once as the pad's emissive map. */
function padPattern(): THREE.CanvasTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  if (!context) return texture
  const centre = size / 2
  context.fillStyle = '#000'
  context.fillRect(0, 0, size, size)
  context.strokeStyle = 'rgba(245, 166, 35, 0.55)'
  for (const [radius, width] of [
    [246, 3],
    [214, 1],
    [120, 1.5],
    [40, 2],
  ] as const) {
    context.lineWidth = width
    context.beginPath()
    context.arc(centre, centre, radius, 0, Math.PI * 2)
    context.stroke()
  }
  for (let i = 0; i < 72; i++) {
    const angle = (i / 72) * Math.PI * 2
    const long = i % 6 === 0
    context.lineWidth = long ? 2 : 1
    context.strokeStyle = long ? 'rgba(245, 166, 35, 0.7)' : 'rgba(245, 166, 35, 0.3)'
    context.beginPath()
    context.moveTo(centre + Math.cos(angle) * 218, centre + Math.sin(angle) * 218)
    context.lineTo(centre + Math.cos(angle) * (long ? 240 : 230), centre + Math.sin(angle) * (long ? 240 : 230))
    context.stroke()
  }
  return texture
}

/** The courier's name and standing, set along the near side of the floor ring. */
function paintInscription(context: CanvasRenderingContext2D, courier: CourierView): void {
  const size = RING.canvas
  const centre = size / 2
  const radius = (((RING.inner + RING.outer) / 2) / RING.outer) * centre
  const words = courier.name !== null && courier.level !== null ? [courier.name, `LEVEL ${courier.level}`, ...(courier.rank ? [courier.rank] : [])] : [courier.setUp ? 'YOUR COURIER' : 'SET UP YOUR COURIER']
  const pieces = words.flatMap((word, index) => (index === 0 ? [word.toLocaleUpperCase('en-US')] : ['◆', word.toLocaleUpperCase('en-US')]))

  setFont(context, 21, FONT.sign)
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const spacing = 3
  const glyphs = pieces.flatMap((piece, index) => [...(index > 0 ? [' '] : []), ...Array.from(piece), ...(index < pieces.length - 1 ? [' '] : [])].map(glyph => ({ glyph, diamond: piece === '◆' })))
  const widths = glyphs.map(({ glyph }) => context.measureText(glyph).width + spacing)
  const total = widths.reduce((sum, width) => sum + width, 0)
  let angle = Math.PI / 2 + total / radius / 2
  glyphs.forEach(({ glyph, diamond }, index) => {
    const width = widths[index] ?? 0
    const glyphAngle = angle - width / radius / 2
    context.save()
    context.translate(centre + Math.cos(glyphAngle) * radius, centre + Math.sin(glyphAngle) * radius)
    context.rotate(glyphAngle - Math.PI / 2)
    context.fillStyle = diamond ? INK.gold : courier.name ? INK.text : INK.muted
    context.globalAlpha = diamond ? 0.9 : 0.82
    context.fillText(glyph, 0, 1)
    context.restore()
    angle -= width / radius
  })
  context.textBaseline = 'alphabetic'
  context.globalAlpha = 1
}
