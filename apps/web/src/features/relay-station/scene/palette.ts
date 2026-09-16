import * as THREE from 'three'

/**
 * The station at night. Midnight graphite carries the architecture, NIM gold is
 * the light you can act on, cyan is reserved for what is live and verified.
 * Colours are sRGB hex converted to linear working space by three.
 */
export const HEX = {
  void: '#0a0e1a',
  graphite: '#1a2131',
  graphiteDeep: '#0e131d',
  stone: '#2a2c33',
  gold: '#f5a623',
  goldDeep: '#e8890a',
  lamp: '#ffc46e',
  cyan: '#22d3ee',
  ink: '#f2e8d5',
  inkMuted: '#8b93a7',
  flap: '#141821',
} as const

export const COLOR = {
  fog: new THREE.Color('#10182c'),
  skyZenith: new THREE.Color('#02040b'),
  skyMid: new THREE.Color('#07102a'),
  skyHorizon: new THREE.Color('#152040'),
  cityGlow: new THREE.Color('#ffae55'),
  graphite: new THREE.Color(HEX.graphite),
  graphiteDeep: new THREE.Color(HEX.graphiteDeep),
  stone: new THREE.Color(HEX.stone),
  gold: new THREE.Color(HEX.gold),
  goldDeep: new THREE.Color(HEX.goldDeep),
  lamp: new THREE.Color(HEX.lamp),
  cyan: new THREE.Color(HEX.cyan),
  windowWarm: new THREE.Color('#ffb466'),
  windowCool: new THREE.Color('#d9e2ff'),
} as const

/** Canvas colours for in-world displays. */
export const INK = {
  panel: '#07090e',
  panelEdge: '#1b2130',
  flapTop: '#1a1e28',
  flapBottom: '#12151d',
  hinge: '#040508',
  text: HEX.ink,
  muted: '#7f8799',
  faint: '#3a4150',
  gold: HEX.gold,
  goldDeep: HEX.goldDeep,
  cyan: HEX.cyan,
  engraved: '#0c0f16',
  engravedLight: 'rgba(255, 236, 200, 0.12)',
} as const
