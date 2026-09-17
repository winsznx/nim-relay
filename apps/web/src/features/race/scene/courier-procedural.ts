import * as THREE from 'three'
import { relayLeg } from '@nim-relay/game-engine'
import type { CourierDrive } from './courier'
import { applyPose, neutralPose, type PoseParams } from './courier-pose'
import { buildCourierRig, type CourierPalette, type CourierRig, type CourierSlot } from './courier-rig'
import { addRimLight } from './materials'

/**
 * The lightweight procedural courier. It draws instantly while the model body
 * streams in, and stays as the courier if the model cannot load.
 */

export interface ProceduralCourier {
  readonly group: THREE.Group
  readonly rig: CourierRig
  update(drive: CourierDrive): void
  dispose(): void
}

interface Spring {
  value: number
  velocity: number
}

function stepSpring(spring: Spring, dt: number, stiffness: number, damping: number): void {
  spring.velocity += (-stiffness * spring.value - damping * spring.velocity) * dt
  spring.value += spring.velocity * dt
}

function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt))
}

export function createProceduralCourier(palette: CourierPalette, rim: THREE.Color, ghostMaterial: THREE.Material | null, castShadow: boolean): ProceduralCourier {
  const rig = buildCourierRig(palette)
  const group = new THREE.Group()
  group.name = 'procedural-courier'
  group.add(rig.root)
  const materials: THREE.Material[] = []

  const liveMaterial = (slot: CourierSlot): THREE.Material => {
    if (slot === 'glow') return new THREE.MeshBasicMaterial({ vertexColors: true })
    const settings = {
      suit: { roughness: 0.58, metalness: 0.12 },
      armor: { roughness: 0.24, metalness: 0.28 },
      visor: { roughness: 0.05, metalness: 0.95 },
    }[slot]
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, ...settings })
    addRimLight(material, rim.clone().multiplyScalar(slot === 'visor' ? 0.3 : 0.7), 2.8)
    return material
  }

  for (const slot of ['suit', 'armor', 'visor', 'glow'] as const) {
    const material = ghostMaterial ?? liveMaterial(slot)
    if (!ghostMaterial) materials.push(material)
    const mesh = new THREE.SkinnedMesh(rig.geometries[slot], material)
    mesh.bind(rig.skeleton, new THREE.Matrix4())
    mesh.frustumCulled = false
    mesh.castShadow = castShadow && !ghostMaterial && slot !== 'glow'
    group.add(mesh)
  }

  const pose: PoseParams = neutralPose()
  const compress: Spring = { value: 0, velocity: 0 }
  const flinch: Spring = { value: 0, velocity: 0 }

  return {
    group,
    rig,
    update(drive) {
      const { dt, act, actProgress: t } = drive
      if (drive.events & relayLeg.EVENT.LAND) compress.velocity += drive.events & relayLeg.EVENT.CLEAN_LAND ? 5.5 : 7.5
      if (drive.events & relayLeg.EVENT.JUMP) compress.velocity -= 2.5
      if (drive.events & relayLeg.EVENT.NEAR_MISS) flinch.velocity += (drive.lateralVelocity >= 0 ? -1 : 1) * 9
      if (drive.events & relayLeg.EVENT.HIT) compress.velocity += 6
      stepSpring(compress, dt, 90, 11)
      stepSpring(flinch, dt, 70, 9)

      const riding = act === 'ride'
      const motion = drive.motion ?? 'riding'
      const grind = motion === 'grinding' ? (drive.edgeSide ?? 0) : 0
      const loose = motion === 'falling' || motion === 'tethering'
      const lean = Math.max(-1, Math.min(1, drive.lateralVelocity / 7 - grind * 0.7))
      pose.lean = approach(pose.lean, riding ? lean : 0, 9, dt)
      pose.twist = approach(pose.twist, riding ? lean * 0.6 : 0, 6, dt)
      pose.tuck = approach(pose.tuck, drive.airborne || motion === 'falling' ? 1 : 0, drive.airborne ? 10 : 18, dt)
      pose.slide = approach(pose.slide, drive.sliding ? 1 : 0, drive.sliding ? 16 : 8, dt)
      pose.stumble = approach(pose.stumble, drive.stumbling || grind !== 0 ? 1 : 0, 10, dt)
      pose.tucked = approach(pose.tucked, riding ? Math.max(Math.max(0, drive.flow - 0.55) / 0.45, drive.rush ?? 0) : 0, 3, dt)
      pose.pitch = approach(pose.pitch, act === 'failed' ? 0.8 : riding ? 0.35 + drive.flow * 0.4 : act === 'anticipate' ? 0.55 : 0.15, 4, dt)
      pose.crouch = approach(pose.crouch, act === 'failed' ? 1 : act === 'anticipate' ? 0.9 : drive.railing || grind !== 0 ? 0.55 : loose ? 0 : riding ? 0.2 : 0.05, 6, dt)
      pose.armsOut = approach(pose.armsOut, drive.airborne || loose || grind !== 0 ? 1 : riding ? 0.55 + Math.abs(lean) * 0.4 : 0.35, 5, dt)
      pose.reach = approach(pose.reach, act === 'catch' ? Math.sin(Math.min(1, t) * Math.PI) : 0, 12, dt)
      pose.batonUp = approach(pose.batonUp, act === 'prepare' || motion === 'tethering' ? 1 : act === 'throw' ? 1 - t : 0, 5, dt)
      pose.throwSwing = act === 'throw' ? Math.min(1, t * 1.6) : approach(pose.throwSwing, 0, 6, dt)
      pose.victory = approach(pose.victory, act === 'victory' || act === 'finish' ? 1 : 0, act === 'finish' ? 3 : 5, dt)
      pose.compress = Math.max(-0.3, compress.value)
      pose.flinch = Math.max(-1, Math.min(1, flinch.value))
      pose.boardPitch = approach(pose.boardPitch, drive.airborne ? 0.14 : 0, 7, dt)
      pose.boardRoll = approach(pose.boardRoll, riding ? -lean * 0.22 : 0, 8, dt)
      applyPose(rig, pose, drive.time)
    },
    dispose() {
      group.removeFromParent()
      for (const geometry of Object.values(rig.geometries)) geometry.dispose()
      for (const material of materials) material.dispose()
      rig.skeleton.dispose()
    },
  }
}
