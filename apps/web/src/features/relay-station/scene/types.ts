import type * as THREE from 'three'
import type { StationSurfaceId, StationViewData } from '../view-model'

export type QualityTier = 'high' | 'medium' | 'low'
export type QualityPreference = QualityTier | 'auto'

export interface RelayStationOptions {
  /** A tap on a surface focuses it and reports its id; a tap on open space while focused reports null. */
  onSelect(surfaceId: StationSurfaceId | null): void
  quality?: QualityPreference
  /** Defaults to the `prefers-reduced-motion` media query, followed live. */
  reducedMotion?: boolean
}

export interface RelayStationStats {
  drawCalls: number
  triangles: number
  tier: QualityTier
  pixelRatio: number
}

export interface RelayStationHandle {
  update(data: StationViewData): void
  focus(surfaceId: StationSurfaceId | null): void
  stats(): RelayStationStats
  dispose(): void
}

/** What the camera must frame to read a surface: the display centre, the side to view it from, and its size in metres. */
export interface FocusFrame {
  center: THREE.Vector3
  /** Horizontal unit direction from the centre towards the camera. */
  normal: THREE.Vector3
  /** Upward tilt of the approach, so the camera can look over whatever stands in front. */
  elevation: number
  width: number
  height: number
}

export interface StationSurface {
  readonly id: StationSurfaceId
  readonly root: THREE.Object3D
  /** Invisible, deliberately oversized volume for thumb-friendly picking. */
  readonly hitTarget: THREE.Mesh
  readonly frame: FocusFrame
  update(data: StationViewData): void
  setFocused(focused: boolean): void
  tick(time: number, delta: number): void
  dispose(): void
}
