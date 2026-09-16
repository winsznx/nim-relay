import * as THREE from 'three'
import { createPointCloud, markDirty, relayColor, writePoint, type GlobeRelay } from './routes'

/**
 * Relays whose holder did not share a country circle the Earth on a separate
 * orbit instead of being placed on a guessed location.
 */

const ORBIT_RADIUS = 1.16
const LABEL = 'Location not shared'
const LABEL_PX = 24
const PREFERRED_LABEL_DEGREES = 135
/** Every 5° around the ring, nearest the upper left first. */
const LABEL_ANGLES = Array.from({ length: 72 }, (_, i) => i * 5)
  .sort((a, b) => Math.abs(((a - PREFERRED_LABEL_DEGREES + 540) % 360) - 180) - Math.abs(((b - PREFERRED_LABEL_DEGREES + 540) % 360) - 180))
  .map(degrees => THREE.MathUtils.degToRad(degrees))
const TOP_BAR_CLEARANCE = 70

function labelTexture(): { texture: THREE.CanvasTexture; aspect: number } {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  const font = '600 28px -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif'
  let width = 340
  if (context) {
    context.font = font
    width = Math.ceil(context.measureText(LABEL).width) + 64
  }
  canvas.width = width
  canvas.height = 56
  if (context) {
    context.font = font
    context.fillStyle = 'rgba(7, 10, 20, 0.82)'
    context.beginPath()
    context.roundRect(1, 1, width - 2, 54, 27)
    context.fill()
    context.strokeStyle = 'rgba(210, 222, 255, 0.2)'
    context.lineWidth = 2
    context.stroke()
    context.fillStyle = 'rgba(214, 222, 238, 0.92)'
    context.textBaseline = 'middle'
    context.fillText(LABEL, 46, 29)
    context.strokeStyle = 'rgba(214, 222, 238, 0.6)'
    context.lineWidth = 2.5
    context.setLineDash([3, 3])
    context.beginPath()
    context.arc(26, 28, 7, 0, Math.PI * 2)
    context.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return { texture, aspect: width / 56 }
}

export interface UnlocatedOrbit {
  group: THREE.Group
  setRelays(relays: readonly GlobeRelay[]): void
  /** Positions of orbiting batons in world space, for picking. */
  targets(): { id: string; position: THREE.Vector3 }[]
  update(camera: THREE.PerspectiveCamera, time: number, motion: number, width: number, height: number): void
  flash(batonId: string, time: number): void
  dispose(): void
}

export function createUnlocatedOrbit(pointMaterial: THREE.ShaderMaterial): UnlocatedOrbit {
  const group = new THREE.Group()
  group.visible = false
  const ringGeometry = new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 161 }, (_, i) => {
      const angle = (i / 160) * Math.PI * 2
      return new THREE.Vector3(Math.cos(angle) * ORBIT_RADIUS, Math.sin(angle) * ORBIT_RADIUS, 0)
    }),
  )
  const ringMaterial = new THREE.LineDashedMaterial({ color: 0x8f9bb5, dashSize: 0.028, gapSize: 0.028, transparent: true, opacity: 0.3, depthWrite: false })
  const ring = new THREE.Line(ringGeometry, ringMaterial)
  ring.computeLineDistances()
  group.add(ring)

  const { texture, aspect } = labelTexture()
  const labelMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, sizeAttenuation: false })
  const label = new THREE.Sprite(labelMaterial)
  label.renderOrder = 10
  group.add(label)

  const capacity = 24
  const cloud = createPointCloud(capacity, pointMaterial)
  group.add(cloud.points)

  let relays: readonly GlobeRelay[] = []
  let flashes = new Map<string, number>()
  let lastTime = 0
  let lastMotion = 1
  const local = new THREE.Vector3()
  const world = new THREE.Vector3()

  const ringPoint = (angle: number, target: THREE.Vector3) => target.set(Math.cos(angle) * ORBIT_RADIUS, Math.sin(angle) * ORBIT_RADIUS, 0)
  const angleFor = (index: number, time: number, motion: number) => Math.PI * 0.35 + index * ((Math.PI * 2) / Math.max(1, relays.length)) + time * 0.06 * motion

  let placedFor = ''
  /** Keeps the label on screen, clear of the top bar and the lower half where cards sit. */
  function placeLabel(camera: THREE.PerspectiveCamera, width: number, height: number): void {
    const key = `${width}x${height}:${camera.position.length().toFixed(2)}:${camera.view?.offsetY ?? 0}`
    if (key === placedFor) return
    placedFor = key
    const labelWidth = LABEL_PX * aspect
    for (const angle of LABEL_ANGLES) {
      group.localToWorld(ringPoint(angle, world))
      const ndc = world.project(camera)
      const x = ((ndc.x + 1) / 2) * width
      const y = ((1 - ndc.y) / 2) * height
      if (x > labelWidth / 2 + 8 && x < width - labelWidth / 2 - 8 && y > TOP_BAR_CLEARANCE && y < height * 0.5) {
        ringPoint(angle, label.position)
        label.visible = true
        return
      }
    }
    label.visible = false
  }

  return {
    group,
    setRelays(next) {
      relays = next.slice(0, capacity)
      group.visible = relays.length > 0
      flashes = new Map([...flashes].filter(([id]) => relays.some(relay => relay.id === id)))
    },
    targets() {
      return relays.map((relay, index) => ({ id: relay.id, position: group.localToWorld(ringPoint(angleFor(index, lastTime, lastMotion), new THREE.Vector3())) }))
    },
    update(camera, time, motion, width, height) {
      lastTime = time
      lastMotion = motion
      if (!group.visible) return
      group.quaternion.copy(camera.quaternion)
      group.updateMatrixWorld()
      const projection = camera.projectionMatrix.elements[5] ?? 3
      label.scale.set(((LABEL_PX / height) * 2 * aspect) / projection, ((LABEL_PX / height) * 2) / projection, 1)
      placeLabel(camera, width, height)
      relays.forEach((relay, index) => {
        ringPoint(angleFor(index, time, motion), local)
        const flashAt = flashes.get(relay.id)
        const flash = flashAt === undefined ? 0 : Math.max(0, 1 - (time - flashAt) / 2.2)
        const active = relay.status === 'active'
        const kind = active ? (relay.live ? 4 : 1) : 0
        writePoint(cloud.buffers, index, local, relayColor(relay), 22 + flash * 34, kind, index * 0.29, active ? 0.9 : 0.4)
      })
      markDirty(cloud.geometry, relays.length)
    },
    flash(batonId, time) {
      flashes.set(batonId, time)
    },
    dispose() {
      ringGeometry.dispose()
      ringMaterial.dispose()
      texture.dispose()
      labelMaterial.dispose()
      cloud.geometry.dispose()
      group.removeFromParent()
    },
  }
}
