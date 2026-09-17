import * as THREE from 'three'
import { relayLeg } from '@nim-relay/game-engine'
import { createBatonObject, type BatonObject } from '../../baton/baton-mesh'
import type { BatonAppearance } from '../../baton/baton-appearance'
import { createGear, type Gear } from './courier-gear'
import { createGhostMaterial, createSuitMaterial, instantiateBody, loadCourierAssets, type CourierAssets, type CourierBody } from './courier-model'
import { CourierMotion } from './courier-motion'
import { createProceduralCourier, type ProceduralCourier } from './courier-procedural'
import type { CourierPalette } from './courier-rig'

/**
 * The courier as seen in the race. It starts as a light procedural figure and
 * becomes the full model courier (CC0 Quaternius body, procedural suit, helmet
 * and hoverboard) once the model streams in. Cosmetics tint every material; the
 * ghost variant is a translucent cyan-white fresnel with a name tag.
 */

export interface CourierCosmetics {
  suit?: string
  helmet?: string
  board?: string
  trail?: string
  crewColor?: string
  body?: CourierBody
}

export type CourierAct = 'idle' | 'anticipate' | 'catch' | 'ride' | 'finish' | 'victory' | 'prepare' | 'throw' | 'failed'

export interface CourierDrive {
  time: number
  dt: number
  act: CourierAct
  /** 0..1 progress through the current act, when it is timed. */
  actProgress: number
  /** Lateral velocity in metres per second, positive to the right. */
  lateralVelocity: number
  airborne: boolean
  sliding: boolean
  stumbling: boolean
  railing: boolean
  /** 0..1 */
  flow: number
  events: number
  /** Metres the baton floats above the hand, for the frozen handoff beat. */
  batonLift: number
  /** Locomotion phase from the simulation; riding when omitted. */
  motion?: relayLeg.Motion
  /** -1 left, 1 right: the edge being ground or fallen from. */
  edgeSide?: -1 | 0 | 1
  /** -1..1: a lane change under way, signed toward the new lane. */
  laneShift?: number
  /** 0..1 Relay Rush. */
  rush?: number
  /** 0..1 riding the shoulder outside the lanes. */
  shoulder?: number
  /** 0..1 the carried baton blazing (Relay Rush, a relay cut). */
  blaze?: number
}

export interface Courier {
  readonly group: THREE.Group
  readonly baton: BatonObject | null
  /** World position of the baton core, updated every frame. */
  readonly batonWorld: THREE.Vector3
  /** World position of the baton's holster on the right hip, updated every frame. */
  readonly holsterWorld: THREE.Vector3
  readonly trailColor: THREE.Color
  update(drive: CourierDrive): void
  /** Slides the name tag back inside the frame when the ghost is at the edge of the screen. */
  keepTagInView(camera: THREE.PerspectiveCamera): void
  setVisible(visible: boolean): void
  dispose(): void
}

/** NDC limits for the ghost's name tag: clear of the screen edges and the HUD across the top. */
const TAG_EDGE = 0.94
const TAG_TOP = 0.7
/** Tag width in metres, shrunk with camera distance so a ghost passing the lens never gets a giant label. */
const TAG_WIDTH = 1.3
const TAG_WIDTH_PER_METRE = 0.14

export interface CourierOptions {
  cosmetics?: CourierCosmetics
  baton?: BatonAppearance | null
  ghostName?: string | null
  rimColor: THREE.Color
  castShadow: boolean
}

const COSMETIC_COLORS: Readonly<Record<string, string>> = {
  midnight: '#1a2032',
  graphite: '#20242c',
  pearl: '#ebe7df',
  solar: '#e9dfcf',
  ice: '#b8d3e4',
  vector: '#1c2c42',
  ember: '#6a2a1a',
  crimson: '#a3202c',
  halo: '#f5c969',
  gold: '#f5a623',
  aurora: '#8fdcc7',
  comet: '#c98c4f',
  visor: '#e6e8ee',
}

function cosmeticColor(value: string | undefined, fallback: string): THREE.Color {
  if (value && COSMETIC_COLORS[value]) return new THREE.Color(COSMETIC_COLORS[value])
  if (value && /^#[0-9a-f]{6}$/i.test(value)) return new THREE.Color(value)
  return new THREE.Color(fallback)
}

export function courierPalette(cosmetics: CourierCosmetics = {}): CourierPalette {
  return {
    suit: cosmeticColor(cosmetics.suit, '#171b24'),
    suitPanel: cosmetics.crewColor ? cosmeticColor(cosmetics.crewColor, '#2a303d') : new THREE.Color('#2a303d'),
    armor: cosmeticColor(cosmetics.helmet, '#7d8594'),
    armorTrim: new THREE.Color('#2f343f'),
    board: cosmeticColor(cosmetics.board, '#12151c'),
    boardTrim: new THREE.Color('#353a46'),
    light: new THREE.Color(2.7, 1.45, 0.32),
    visorLight: new THREE.Color(3.2, 1.9, 0.5),
  }
}

export function trailColorFor(cosmetics: CourierCosmetics = {}): THREE.Color {
  if (cosmetics.trail === 'aurora') return new THREE.Color(0.6, 2.2, 1.6)
  if (cosmetics.trail === 'ember') return new THREE.Color(2.8, 0.7, 0.2)
  if (cosmetics.trail && /^#[0-9a-f]{6}$/i.test(cosmetics.trail)) return new THREE.Color(cosmetics.trail).multiplyScalar(2)
  return new THREE.Color(2.6, 1.35, 0.25)
}

function nameTag(name: string): { sprite: THREE.Sprite; texture: THREE.CanvasTexture; material: THREE.SpriteMaterial } {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (context) {
    context.font = '800 58px Inter, -apple-system, BlinkMacSystemFont, sans-serif'
    const label = name.toUpperCase().slice(0, 14)
    const width = Math.min(480, context.measureText(label).width + 72)
    const x = (512 - width) / 2
    context.fillStyle = 'rgba(6, 18, 26, 0.72)'
    context.beginPath()
    context.roundRect(x, 18, width, 92, 46)
    context.fill()
    context.strokeStyle = 'rgba(34, 211, 238, 0.85)'
    context.lineWidth = 4
    context.stroke()
    context.fillStyle = '#d9fbff'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(label, 256, 66)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(1.3, 0.325, 1)
  sprite.renderOrder = 20
  return { sprite, texture, material }
}

interface ModelCourier {
  root: THREE.Group
  motion: CourierMotion
  gear: Gear
  suit: THREE.Material | null
  hand: THREE.Bone | null
  back: THREE.Bone | null
  /** Rim colours the suit and helmet shaders read by reference, turned gold through Relay Rush. */
  suitRim: THREE.Color
  gearRim: THREE.Color
  dispose(): void
}

const HELMET_CENTRE = new THREE.Vector3(0, 1.69, 0.01)
const SUIT_RIM_SHARE = 0.4
/** Relay Rush rim light: the courier outlined in hot gold. */
const RUSH_RIM = new THREE.Color(1.7, 0.95, 0.22)
/** Seconds a knock leaves the carried baton flickering. */
const FLICKER_SECONDS = 0.7
/** The holster sits this far behind and to the right of the pelvis. */
const HOLSTER_BACK = 0.12
const HOLSTER_SIDE = 0.17
/** The carried baton's aura stays near the hand so it never washes over the courier from the chase camera. */
const CARRIED_BATON_GLOW = 0.6
const CARRIED_BATON_LENGTH = 0.58
const COURIER_FILL = new THREE.Color(0.1, 0.095, 0.09)
const HELMET_SHELL = new THREE.Color('#e9e7e2')
const GRIP = new THREE.Vector3(-0.79, 1.44, -0.04)

/** Parents `object` to `bone` so it sits at `modelPosition` (body model space at bind pose). */
function attachAtBind(object: THREE.Object3D, bone: THREE.Bone, bodyRoot: THREE.Object3D, modelPosition: THREE.Vector3, modelRotation: THREE.Euler): void {
  bodyRoot.updateMatrixWorld(true)
  const rootInverse = new THREE.Matrix4().copy(bodyRoot.matrixWorld).invert()
  const boneInModel = new THREE.Matrix4().multiplyMatrices(rootInverse, bone.matrixWorld)
  const desired = new THREE.Matrix4().compose(modelPosition, new THREE.Quaternion().setFromEuler(modelRotation), object.scale.clone())
  const local = new THREE.Matrix4().copy(boneInModel).invert().multiply(desired)
  local.decompose(object.position, object.quaternion, object.scale)
  bone.add(object)
}

function buildModelCourier(assets: CourierAssets, options: CourierOptions, ghostMaterial: THREE.ShaderMaterial | null, baton: BatonObject | null): ModelCourier {
  const palette = courierPalette(options.cosmetics)
  const body = instantiateBody(assets, options.cosmetics?.body ?? 'male')
  const root = new THREE.Group()
  root.name = 'model-courier'
  root.rotation.y = Math.PI
  root.add(body.root)

  const suitRim = options.rimColor.clone().multiplyScalar(SUIT_RIM_SHARE)
  const gearRim = options.rimColor.clone()
  const suit = ghostMaterial
    ? null
    : createSuitMaterial({ suit: palette.suit, panel: palette.suitPanel, armor: palette.armor, light: palette.light.clone().multiplyScalar(0.55), rim: suitRim, fill: COURIER_FILL })
  body.mesh.material = ghostMaterial ?? suit ?? body.mesh.material
  body.mesh.castShadow = options.castShadow && !ghostMaterial
  body.mesh.frustumCulled = false

  const gear = createGear({ shell: HELMET_SHELL, trim: palette.armorTrim, deck: palette.board, light: palette.light, rim: gearRim, fill: COURIER_FILL }, ghostMaterial)
  const head = body.bone('Head')
  if (head) attachAtBind(gear.helmet, head, body.root, HELMET_CENTRE, new THREE.Euler())
  root.add(gear.board)
  const hand = body.bone('hand_r')
  if (hand && baton) attachAtBind(baton.object, hand, body.root, GRIP, new THREE.Euler(Math.PI / 2, 0, 0))

  const motion = new CourierMotion(body, assets.clips, root)
  return {
    root,
    motion,
    gear,
    suit,
    hand,
    back: body.bone('pelvis'),
    suitRim,
    gearRim,
    dispose() {
      motion.dispose()
      gear.dispose()
      suit?.dispose()
      root.removeFromParent()
    },
  }
}

export function createCourier(options: CourierOptions): Courier {
  const ghost = options.ghostName !== undefined && options.ghostName !== null
  const group = new THREE.Group()
  group.name = ghost ? 'ghost-courier' : 'courier'
  const ghostMaterial = ghost ? createGhostMaterial() : null
  const procedural: ProceduralCourier = createProceduralCourier(courierPalette(options.cosmetics), options.rimColor, ghostMaterial, options.castShadow)
  group.add(procedural.group)

  const baton = options.baton ? createBatonObject(options.baton, { length: CARRIED_BATON_LENGTH, variant: ghost ? 'ghost' : 'live', glow: CARRIED_BATON_GLOW }) : null
  if (baton) {
    baton.object.position.set(0, -0.07, -0.02)
    baton.object.rotation.set(Math.PI / 2 - 0.35, 0, 0)
    procedural.rig.bones.handR.add(baton.object)
  }

  const tag = ghost && options.ghostName ? nameTag(options.ghostName) : null
  if (tag) {
    tag.sprite.position.set(0, 2.3, 0)
    group.add(tag.sprite)
  }

  let model: ModelCourier | null = null
  let disposed = false
  const tagView = new THREE.Vector3()
  const batonWorld = new THREE.Vector3()
  const holsterWorld = new THREE.Vector3()
  const backward = new THREE.Vector3()
  const rightward = new THREE.Vector3()
  const feet = new THREE.Vector3()
  const lift = new THREE.Vector3()
  const handQuaternion = new THREE.Quaternion()
  const trailColor = trailColorFor(options.cosmetics)
  let batonRest: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null = null
  let flicker = 0
  let swing = 0
  let swingVelocity = 0
  const swingQuaternion = new THREE.Quaternion()
  const swingAxis = new THREE.Vector3(0, 0, 1)

  loadCourierAssets()
    .then(assets => {
      if (disposed) return
      model = buildModelCourier(assets, options, ghostMaterial, baton)
      if (baton) batonRest = { position: baton.object.position.clone(), quaternion: baton.object.quaternion.clone() }
      procedural.group.visible = false
      group.add(model.root)
    })
    .catch(() => {
      if (!disposed) procedural.group.visible = true
    })

  return {
    group,
    baton,
    batonWorld,
    holsterWorld,
    trailColor,
    update(drive) {
      const knocked = (drive.events & (relayLeg.EVENT.HIT | relayLeg.EVENT.HARD_LANDING | relayLeg.EVENT.FALL)) !== 0
      if (knocked) {
        flicker = 1
        swingVelocity += (drive.lateralVelocity >= 0 ? -1 : 1) * 9
      }
      flicker = Math.max(0, flicker - drive.dt / FLICKER_SECONDS)
      // The carried baton swings on its grip like a pendulum: out toward a rail being ground, and loose after a knock.
      const grinding = drive.motion === 'grinding' ? (drive.edgeSide ?? 0) : 0
      swingVelocity += (-(swing - grinding * 0.55) * 60 - swingVelocity * 7) * drive.dt
      swing += swingVelocity * drive.dt
      if (model) {
        model.motion.update(drive)
        model.motion.feetCentre(feet)
        model.root.worldToLocal(feet)
        model.gear.board.position.set(feet.x * 0.35, Math.min(0.45, feet.y - 0.035), feet.z * 0.35)
        model.gear.board.rotation.z = model.motion.boardRoll
        model.gear.board.visible = drive.act !== 'failed'
        model.gear.boardGlow.opacity = 0.55 + drive.flow * 0.45
        const rush = drive.rush ?? 0
        model.gearRim.copy(options.rimColor).lerp(RUSH_RIM, rush)
        model.suitRim.copy(options.rimColor).multiplyScalar(SUIT_RIM_SHARE).lerp(RUSH_RIM, rush * 0.6)
        if (baton && batonRest && model.hand) {
          baton.object.position.copy(batonRest.position)
          baton.object.quaternion.copy(batonRest.quaternion)
          if (Math.abs(swing) > 1e-4) baton.object.quaternion.multiply(swingQuaternion.setFromAxisAngle(swingAxis, swing))
          if (drive.batonLift > 0) {
            model.hand.getWorldQuaternion(handQuaternion)
            lift.set(0, drive.batonLift, 0).applyQuaternion(handQuaternion.invert())
            baton.object.position.add(lift)
          }
        }
      } else {
        procedural.update(drive)
      }
      if (baton) {
        const energy = Math.max(drive.flow, drive.act === 'throw' || drive.act === 'prepare' ? 1 : 0) * (drive.act === 'failed' ? 0.25 : 1)
        baton.update(drive.time, energy, { flicker, blaze: drive.blaze ?? 0 })
        baton.object.getWorldPosition(batonWorld)
      } else {
        const hand = model?.hand ?? procedural.rig.bones.handR
        hand.getWorldPosition(batonWorld)
      }
      const hip = model?.back ?? procedural.rig.bones.hips
      hip.getWorldPosition(holsterWorld)
      // The group's +Z is the courier's back and +X its right: the holster rides the belt behind the right hip.
      holsterWorld.addScaledVector(group.getWorldDirection(backward), HOLSTER_BACK)
      holsterWorld.addScaledVector(rightward.set(1, 0, 0).transformDirection(group.matrixWorld), HOLSTER_SIDE)
      if (ghostMaterial) ghostMaterial.uniforms.uTime!.value = drive.time
    },
    keepTagInView(camera) {
      if (!tag) return
      tag.sprite.getWorldPosition(tagView).applyMatrix4(camera.matrixWorldInverse)
      const depth = -tagView.z
      tag.sprite.center.set(0.5, 0.5)
      if (depth <= camera.near) return
      const width = Math.min(TAG_WIDTH, Math.max(0.3, depth * TAG_WIDTH_PER_METRE))
      tag.sprite.scale.set(width, width / 4, 1)
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
      const x = tagView.x / (depth * tanHalf * camera.aspect)
      const y = tagView.y / (depth * tanHalf)
      const screenWidth = width / (depth * tanHalf * camera.aspect)
      const screenHeight = width / 4 / (depth * tanHalf)
      if (Math.abs(x) > 1.8) return
      const lowest = 1 - (TAG_EDGE - x) / screenWidth
      const highest = (x + TAG_EDGE) / screenWidth
      tag.sprite.center.x = THREE.MathUtils.clamp(0.5, lowest, Math.max(lowest, highest))
      tag.sprite.center.y = Math.max(0.5, 1 - (TAG_TOP - y) / screenHeight)
    },
    setVisible(visible) {
      group.visible = visible
    },
    dispose() {
      disposed = true
      group.removeFromParent()
      baton?.dispose()
      model?.dispose()
      procedural.dispose()
      ghostMaterial?.dispose()
      if (tag) {
        tag.texture.dispose()
        tag.material.dispose()
      }
    },
  }
}
