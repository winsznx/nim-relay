import * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'
import { linear } from '../track-style'
import type { WorldStyle } from './types'

/**
 * Five distinct places. Each keeps a dark foundation so gold (opportunity) and
 * red (danger) stay the loudest colours on screen, and differs in time of day,
 * air, horizon and materials.
 */

const hdr = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b)

export const WORLD_STYLES: Readonly<Record<relayLeg.World, WorldStyle>> = {
  coast: {
    id: 'coast',
    sky: {
      top: '#070b24', middle: '#2a1d4a', horizon: '#d86a42', bottom: '#150f22', middleHeight: 0.24,
      sunColor: '#ffb36e', sunDirection: [0.62, 0.035, -0.78], sunSize: 0.035, sunGlow: 1.25, sunSpread: 5,
      stars: 0.08, haze: 0.55, clouds: 0.6, cloudColor: '#3b2447', shimmer: 0,
    },
    fogColor: '#3a2742',
    fogDensity: 0.0026,
    lighting: {
      hemisphereSky: '#8d7fc4', hemisphereGround: '#2b1d2c', hemisphereIntensity: 0.8,
      keyColor: '#ffb27a', keyIntensity: 1.8, keyDirection: [0.5, 0.9, -0.6],
      exposure: 1.02, environmentIntensity: 0.9, courierRim: '#ff9d62',
    },
    track: {
      deck: linear('#1e222d'), shoulder: linear('#2b303c'), skirt: linear('#151821'), underside: linear('#0f1117'),
      curb: linear('#525b6e'), support: linear('#1f232d'), edgeLight: hdr(2.3, 1.85, 1.4), edgeStud: hdr(4.2, 3.2, 2.3),
      laneLight: hdr(0.55, 0.46, 0.4), floorDepth: 36, supportSpacing: 34,
    },
    deckRoughness: 0.46,
    deckMetalness: 0.32,
  },
  metro: {
    id: 'metro',
    sky: {
      top: '#020309', middle: '#0a0f22', horizon: '#3f2a26', bottom: '#07070c', middleHeight: 0.2,
      sunColor: '#9fb4d8', sunDirection: [-0.35, 0.42, -0.84], sunSize: 0.016, sunGlow: 0.3, sunSpread: 28,
      stars: 0.1, haze: 1.0, clouds: 0.45, cloudColor: '#1b1822', shimmer: 0,
    },
    fogColor: '#1a1620',
    fogDensity: 0.0034,
    lighting: {
      hemisphereSky: '#5a6a9e', hemisphereGround: '#1f1611', hemisphereIntensity: 0.6,
      keyColor: '#a9bbff', keyIntensity: 1.05, keyDirection: [-0.4, 0.8, -0.35],
      exposure: 1.08, environmentIntensity: 0.75, courierRim: '#7b92ff',
    },
    track: {
      deck: linear('#131722'), shoulder: linear('#1e2432'), skirt: linear('#0e1118'), underside: linear('#0a0c11'),
      curb: linear('#3c4458'), support: linear('#171a22'), edgeLight: hdr(1.45, 1.6, 2.3), edgeStud: hdr(3.1, 3.3, 4.2),
      laneLight: hdr(0.34, 0.38, 0.52), floorDepth: 44, supportSpacing: 36,
    },
    deckRoughness: 0.3,
    deckMetalness: 0.45,
  },
  alpine: {
    id: 'alpine',
    sky: {
      top: '#06112a', middle: '#1b3764', horizon: '#86a1c4', bottom: '#2a3a52', middleHeight: 0.3,
      sunColor: '#ffc39c', sunDirection: [-0.58, 0.06, -0.81], sunSize: 0, sunGlow: 0.95, sunSpread: 7,
      stars: 0.3, haze: 0.45, clouds: 0.45, cloudColor: '#61779c', shimmer: 0,
    },
    fogColor: '#566d8f',
    fogDensity: 0.003,
    lighting: {
      hemisphereSky: '#a3bde6', hemisphereGround: '#39414f', hemisphereIntensity: 0.95,
      keyColor: '#d9e6ff', keyIntensity: 1.1, keyDirection: [-0.5, 0.72, -0.4],
      exposure: 1.0, environmentIntensity: 0.85, courierRim: '#bcd5ff',
    },
    track: {
      deck: linear('#262c37'), shoulder: linear('#353c4a'), skirt: linear('#1d222b'), underside: linear('#161a22'),
      curb: linear('#d7dee8'), support: linear('#272d38'), edgeLight: hdr(1.8, 2.05, 2.6), edgeStud: hdr(3.2, 3.6, 4.3),
      laneLight: hdr(0.52, 0.56, 0.64), floorDepth: 72, supportSpacing: 40,
    },
    deckRoughness: 0.5,
    deckMetalness: 0.25,
  },
  solar: {
    id: 'solar',
    sky: {
      top: '#120a2a', middle: '#5b1d3d', horizon: '#ff7f33', bottom: '#3a1a18', middleHeight: 0.19,
      sunColor: '#ffae55', sunDirection: [0.08, 0.045, -1], sunSize: 0.055, sunGlow: 1.1, sunSpread: 6,
      stars: 0.03, haze: 0.9, clouds: 0.32, cloudColor: '#4c1d33', shimmer: 1,
    },
    fogColor: '#5a2b2c',
    fogDensity: 0.0024,
    lighting: {
      hemisphereSky: '#ff9d72', hemisphereGround: '#3a1f18', hemisphereIntensity: 0.72,
      keyColor: '#ffb06e', keyIntensity: 1.8, keyDirection: [0.1, 0.95, -0.8],
      exposure: 0.96, environmentIntensity: 0.85, courierRim: '#ff8c4e',
    },
    track: {
      deck: linear('#211b1a'), shoulder: linear('#2e2624'), skirt: linear('#17110f'), underside: linear('#110c0b'),
      curb: linear('#5d4c46'), support: linear('#271f1c'), edgeLight: hdr(2.4, 1.7, 1.15), edgeStud: hdr(4.0, 2.9, 1.9),
      laneLight: hdr(0.58, 0.43, 0.34), floorDepth: 30, supportSpacing: 34,
    },
    deckRoughness: 0.55,
    deckMetalness: 0.28,
  },
  ocean: {
    id: 'ocean',
    sky: {
      top: '#01040c', middle: '#05182b', horizon: '#1b3d4d', bottom: '#030d14', middleHeight: 0.24,
      sunColor: '#d6ebff', sunDirection: [0.36, 0.3, -0.88], sunSize: 0.028, sunGlow: 0.6, sunSpread: 30,
      stars: 0.55, haze: 0.55, clouds: 0.5, cloudColor: '#12283a', shimmer: 0,
    },
    fogColor: '#0d2231',
    fogDensity: 0.003,
    lighting: {
      hemisphereSky: '#6f9fc9', hemisphereGround: '#08161d', hemisphereIntensity: 0.62,
      keyColor: '#d3e8ff', keyIntensity: 1.2, keyDirection: [0.3, 0.9, -0.6],
      exposure: 1.06, environmentIntensity: 0.8, courierRim: '#86cfff',
    },
    track: {
      deck: linear('#131d24'), shoulder: linear('#1d2a35'), skirt: linear('#0c141a'), underside: linear('#091015'),
      curb: linear('#3a5062'), support: linear('#15212a'), edgeLight: hdr(1.8, 2.0, 2.2), edgeStud: hdr(3.2, 3.5, 3.8),
      laneLight: hdr(0.36, 0.45, 0.5), floorDepth: 26, supportSpacing: 32,
    },
    deckRoughness: 0.4,
    deckMetalness: 0.35,
  },
}
