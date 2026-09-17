import * as THREE from 'three'

/** Per-world colours for the track kit. Colours are linear; values above 1 glow. */
export interface TrackStyle {
  deck: THREE.Color
  shoulder: THREE.Color
  skirt: THREE.Color
  underside: THREE.Color
  curb: THREE.Color
  support: THREE.Color
  edgeLight: THREE.Color
  edgeStud: THREE.Color
  laneLight: THREE.Color
  /** Metres below the lowest route point where support columns end. */
  floorDepth: number
  supportSpacing: number
}

export const GOLD = {
  line: new THREE.Color(1.9, 0.98, 0.16),
  bright: new THREE.Color(4.2, 2.2, 0.42),
  soft: new THREE.Color(0.9, 0.46, 0.08),
  deep: new THREE.Color(0.42, 0.2, 0.03),
}

export const DANGER = {
  red: new THREE.Color(3.4, 0.2, 0.26),
  soft: new THREE.Color(1.3, 0.08, 0.1),
  body: new THREE.Color(0.32, 0.03, 0.04),
  stripeDark: new THREE.Color(0.02, 0.02, 0.025),
}

export const GHOST_CYAN = new THREE.Color(0.55, 1.9, 2.3)

export function linear(hex: string, intensity = 1): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(intensity)
}
