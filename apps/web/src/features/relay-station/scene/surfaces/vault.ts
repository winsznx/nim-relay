import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createBatonObject, type BatonObject } from '../../../baton/baton-mesh'
import type { StationViewData, VaultBaton, VaultView } from '../../view-model'
import { FONT, capBaseline, createCanvasDisplay, createDisplayMaterial, fitText, setFont } from '../display'
import type { StationKit } from '../kit'
import { PLACEMENT, placeSurface } from '../layout'
import { COLOR, INK } from '../palette'
import { createGlassMaterial } from '../shaders'
import type { StationSurface } from '../types'
import { approach, at, createHitTarget, focusFrame, roundedSlab } from './common'

interface Pedestal {
  x: number
  z: number
  height: number
  radius: number
  batonLength: number
}

/** Left, legend, right. The legend's pedestal stands taller. */
const PEDESTALS: readonly Pedestal[] = [
  { x: -1.18, z: 0.12, height: 0.82, radius: 0.46, batonLength: 0.74 },
  { x: 0, z: -0.22, height: 1.12, radius: 0.54, batonLength: 0.9 },
  { x: 1.18, z: 0.12, height: 0.82, radius: 0.46, batonLength: 0.74 },
]
const PLINTH_HEIGHT = 0.42
const CASE_HEIGHT = 0.64
const PLAQUE = { width: 680, height: 76, meters: [3.5, 0.39] as const }

/** Glass cases on hexagonal pedestals: the network's most travelled Global Relay baton between two of yours. */
export function createVault(kit: StationKit, reducedMotion: () => boolean): StationSurface {
  const root = new THREE.Group()
  root.name = 'vault'
  const surface = placeSurface('vault', root)
  const { tag } = PLACEMENT.vault

  kit.stone.add(roundedSlab(3.8, 1.9, PLINTH_HEIGHT, 0.35, 0.03).rotateX(-Math.PI / 2), at(surface, 0, PLINTH_HEIGHT / 2, 0))
  kit.lights.add(new THREE.BoxGeometry(3.6, 0.02, 0.02), at(surface, 0, PLINTH_HEIGHT + 0.01, 0.94), tag)

  const cases: THREE.BufferGeometry[] = []
  const pools: THREE.BufferGeometry[] = []
  for (const pedestal of PEDESTALS) {
    const base = PLINTH_HEIGHT
    const top = base + pedestal.height + 0.06
    kit.structure.add(new THREE.CylinderGeometry(pedestal.radius * 0.78, pedestal.radius * 0.9, pedestal.height, 6), at(surface, pedestal.x, base + pedestal.height / 2, pedestal.z))
    kit.structure.add(new THREE.CylinderGeometry(pedestal.radius + 0.04, pedestal.radius + 0.04, 0.06, 6), at(surface, pedestal.x, base + pedestal.height + 0.03, pedestal.z))
    kit.lights.add(new THREE.TorusGeometry(pedestal.radius + 0.01, 0.012, 3, 6).rotateX(Math.PI / 2).rotateY(Math.PI / 6), at(surface, pedestal.x, top + 0.004, pedestal.z), tag)
    kit.structure.add(new THREE.CylinderGeometry(pedestal.radius + 0.03, pedestal.radius + 0.03, 0.04, 6), at(surface, pedestal.x, top + CASE_HEIGHT + 0.02, pedestal.z))
    cases.push(new THREE.CylinderGeometry(pedestal.radius, pedestal.radius, CASE_HEIGHT, 6, 1, true).translate(pedestal.x, top + CASE_HEIGHT / 2, pedestal.z))
    pools.push(new THREE.PlaneGeometry(pedestal.radius * 2.2, pedestal.radius * 2.2).rotateX(-Math.PI / 2).translate(pedestal.x, top + 0.006, pedestal.z))
  }
  const caseMesh = new THREE.Mesh(kit.track(mergeOrEmpty(cases)), kit.track(createGlassMaterial(kit.uniforms, new THREE.Color('#8791a8'), 0.5)))
  caseMesh.renderOrder = 2
  root.add(caseMesh)
  const poolMesh = new THREE.Mesh(
    kit.track(mergeOrEmpty(pools)),
    kit.track(new THREE.MeshBasicMaterial({ map: kit.radial, color: COLOR.lamp, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })),
  )
  root.add(poolMesh)

  const plaque = kit.track(createCanvasDisplay(kit, PLAQUE.width, PLAQUE.height))
  const plaqueMesh = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(...PLAQUE.meters)), createDisplayMaterial(kit, plaque))
  plaqueMesh.position.set(0, PLINTH_HEIGHT / 2, 0.995)
  root.add(plaqueMesh)

  const hitTarget = createHitTarget(kit, root, [4.8, 3.4, 2.8], [0, 1.6, 0.2])
  const frame = focusFrame(root, [0, 0.95, 0.5], 3.7, 2.6, { turn: 0.78, elevation: 0.46 })
  const slots: (BatonObject | null)[] = PEDESTALS.map(() => null)
  let focusedGlow = 0
  let focusedTarget = 0

  function place(slot: number, baton: VaultBaton | null): void {
    const pedestal = PEDESTALS[slot]
    const current = slots[slot]
    if (!pedestal) return
    if (!baton) {
      current?.dispose()
      slots[slot] = null
      return
    }
    if (current) {
      current.setAppearance(baton.appearance)
      return
    }
    const created = createBatonObject(baton.appearance, { length: pedestal.batonLength })
    created.object.position.set(pedestal.x, restHeight(pedestal), pedestal.z)
    root.add(created.object)
    slots[slot] = created
  }

  return {
    id: 'vault',
    root,
    hitTarget,
    frame,
    update(data: StationViewData) {
      const key = JSON.stringify([data.signedIn, data.vault])
      if (!plaque.paint(key, context => paintPlaque(context, data.vault, data.signedIn))) return
      place(0, data.vault.yours[0] ?? null)
      place(1, data.vault.legend)
      place(2, data.vault.yours[1] ?? null)
    },
    setFocused(focused) {
      focusedTarget = focused ? 1 : 0
    },
    tick(time, delta) {
      focusedGlow = approach(focusedGlow, focusedTarget, delta, 4)
      kit.setLightGlow(tag, focusedGlow)
      const pace = reducedMotion() ? 0.3 : 1
      for (let slot = 0; slot < slots.length; slot++) {
        const baton = slots[slot]
        const pedestal = PEDESTALS[slot]
        if (!baton || !pedestal) continue
        baton.object.rotation.set(0, time * 0.35 * pace + slot * 1.7, Math.PI / 2)
        baton.object.position.y = restHeight(pedestal) + Math.sin(time * 1.1 + slot) * 0.025 * pace
        baton.update(time, 0.15 + focusedGlow * 0.45)
      }
    },
    dispose() {
      for (const baton of slots) baton?.dispose()
      root.removeFromParent()
    },
  }
}

/** Batons float level, a hand's width above the pedestal. */
function restHeight(pedestal: Pedestal): number {
  return PLINTH_HEIGHT + pedestal.height + 0.06 + CASE_HEIGHT * 0.45
}

function mergeOrEmpty(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false)
  for (const part of parts) part.dispose()
  return merged ?? new THREE.BufferGeometry()
}

function paintPlaque(context: CanvasRenderingContext2D, vault: VaultView, signedIn: boolean): void {
  const { width, height } = PLAQUE
  context.fillStyle = INK.panel
  context.fillRect(0, 0, width, height)
  const column = width / 3
  const entries: [string, VaultBaton | null, string][] = [
    ['YOURS', vault.yours[0] ?? null, signedIn ? 'Your next baton' : 'Set up a courier'],
    ['GLOBAL LEGEND', vault.legend, 'Awaiting a first handoff'],
    ['YOURS', vault.yours[1] ?? null, signedIn ? 'Room for another' : 'Set up a courier'],
  ]
  entries.forEach(([label, baton, empty], index) => {
    const centre = column * index + column / 2
    context.textAlign = 'center'
    setFont(context, 13, FONT.sign)
    context.fillStyle = index === 1 ? INK.gold : INK.muted
    context.fillText(label, centre, capBaseline(context, 17))
    setFont(context, 20, FONT.sign)
    context.fillStyle = baton ? INK.text : INK.faint
    context.fillText(fitText(context, (baton?.name ?? empty).toLocaleUpperCase('en-US'), column - 28), centre, capBaseline(context, 40))
    if (baton) {
      setFont(context, 14, FONT.sign)
      context.fillStyle = INK.muted
      context.fillText(`${baton.handoffs} ${baton.handoffs === 1 ? 'HANDOFF' : 'HANDOFFS'}`, centre, capBaseline(context, 61))
    }
    if (index > 0) {
      context.fillStyle = INK.panelEdge
      context.fillRect(column * index, 12, 1, height - 24)
    }
  })
}
