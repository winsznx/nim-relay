import type * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'
import type { SceneMaterials } from '../materials'
import type { QualitySettings } from '../quality'
import type { Route } from '../route'
import type { TrackStyle } from '../track-style'

export type Vec3Tuple = readonly [number, number, number]

export interface SkyStyle {
  top: string
  middle: string
  horizon: string
  bottom: string
  /** 0..1 elevation where the middle colour sits. */
  middleHeight: number
  sunColor: string
  sunDirection: Vec3Tuple
  /** Angular size of the sun or moon disc, 0 hides it. */
  sunSize: number
  sunGlow: number
  /** Exponent of the broad glow around the sun or moon: low for sunsets, high for a tight moon halo. */
  sunSpread: number
  stars: number
  haze: number
  /** Low cloud streaks, 0..1. */
  clouds: number
  cloudColor: string
  /** Heat shimmer along the horizon, 0..1. */
  shimmer: number
}

export interface LightingStyle {
  hemisphereSky: string
  hemisphereGround: string
  hemisphereIntensity: number
  keyColor: string
  keyIntensity: number
  keyDirection: Vec3Tuple
  exposure: number
  environmentIntensity: number
  courierRim: string
}

export interface WorldStyle {
  id: relayLeg.World
  sky: SkyStyle
  fogColor: string
  fogDensity: number
  lighting: LightingStyle
  track: TrackStyle
  deckRoughness: number
  deckMetalness: number
}

export interface WorldContext {
  scene: THREE.Scene
  route: Route
  quality: QualitySettings
  materials: SceneMaterials
  floorY: number
  style: WorldStyle
}

export interface WorldFrame {
  time: number
  dt: number
  camera: THREE.PerspectiveCamera
  /** Visual route distance of the courier, metres. */
  dist: number
  /** 0..1 */
  flow: number
  /** 0..1, how far the handoff gate has come alive during the approach and ceremony. */
  finale: number
}

export interface WorldLayer {
  update(frame: WorldFrame): void
  dispose(): void
}

export interface WorldKit {
  style: WorldStyle
  build(context: WorldContext): WorldLayer
}
