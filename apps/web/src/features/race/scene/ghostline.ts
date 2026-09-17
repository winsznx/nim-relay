import * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'
import { possessive } from '../format'
import { fromQ, type Route } from './route'
import { GHOST_CYAN } from './track-style'

/**
 * The Ghostline: the previous runner's verified route drawn on the deck as a thin spectral line,
 * so a courier can see exactly where the last human went, fork choices included. It follows the
 * ghost's own lateral samples, glows faintly ahead of the courier and fades behind, and brightens
 * with a travelling shimmer while the courier drafts it. A small tag near the start names whose
 * line it is.
 */

const PATHS: readonly relayLeg.Path[] = ['main', 'safe', 'risk']
/** Metres between ribbon vertices. */
const SPACING = 1
const HALF_WIDTH = 0.34
const LIFT = 0.045
/** Where the name tag stands, metres into the leg, and how high above the deck. */
const TAG_DIST = 15
const TAG_HEIGHT = 1.2
const TAG_SIDE = 1.2
const TAG_WIDTH = 2.5
/** Keeps fork-path samples that land exactly on a fork boundary inside the fork they belong to. */
const FORK_EPSILON = 1e-3

/** What the Ghostline needs to know about the route: where each path's centre line runs. */
export interface GhostlineRoute {
  readonly forks: readonly { readonly from: number; readonly to: number }[]
  pathOffset(path: relayLeg.Path, d: number): number
}

/** Lateral position of sample `index`, metres from the main centre line. */
function sampleLateral(ghostline: relayLeg.Ghostline, route: GhostlineRoute, index: number): number {
  const path = PATHS[ghostline.path[index] ?? 0] ?? 'main'
  let d = fromQ(ghostline.step * index)
  if (path !== 'main') {
    const fork = route.forks.find(candidate => d >= candidate.from && d <= candidate.to)
    if (fork) d = Math.max(fork.from + FORK_EPSILON, Math.min(fork.to - FORK_EPSILON, d))
  }
  return route.pathOffset(path, d) + (ghostline.x[index] ?? 0) / 100
}

/** Metres of route the ghostline covers. */
export function ghostlineLength(ghostline: relayLeg.Ghostline): number {
  return ghostline.x.length > 1 ? fromQ(ghostline.step * (ghostline.x.length - 1)) : 0
}

/**
 * Lateral position of the ghost's line at route distance `d` (metres), from the main centre line,
 * smoothed through the samples around it. Null outside the line.
 */
export function ghostlineLateral(ghostline: relayLeg.Ghostline, route: GhostlineRoute, d: number): number | null {
  const count = ghostline.x.length
  const step = fromQ(ghostline.step)
  if (count < 2 || step <= 0 || d < 0 || d > ghostlineLength(ghostline)) return null
  const position = d / step
  const i = Math.min(count - 2, Math.floor(position))
  const t = position - i
  const p0 = sampleLateral(ghostline, route, Math.max(0, i - 1))
  const p1 = sampleLateral(ghostline, route, i)
  const p2 = sampleLateral(ghostline, route, i + 1)
  const p3 = sampleLateral(ghostline, route, Math.min(count - 1, i + 2))
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3)
}

const vertexShader = /* glsl */ `
  attribute float aDist;
  attribute float aAcross;
  varying float vDist;
  varying float vAcross;
  void main() {
    vDist = aDist;
    vAcross = aAcross;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uView;
  uniform float uTime;
  uniform float uDraft;
  varying float vDist;
  varying float vAcross;
  void main() {
    float ahead = vDist - uView;
    // Rises out of the deck a little ahead of the board: under an airborne courier the deck just ahead sits below it
    // on screen, and a line lit there reads as a beam to the camera. Faint again far ahead.
    float fade = smoothstep(1.5, 9.0, ahead) * (1.0 - smoothstep(50.0 + uDraft * 50.0, 140.0, ahead));
    float core = exp(-vAcross * vAcross * 26.0);
    float halo = exp(-vAcross * vAcross * 4.0) * (0.12 + uDraft * 0.35);
    float travel = 0.7 + 0.3 * sin((vDist - uTime * 24.0) * 0.8);
    float sparkle = pow(0.5 + 0.5 * sin((vDist - uTime * 38.0) * 0.23), 12.0) * uDraft;
    float intensity = (0.2 + uDraft * 0.85) * (core + halo) * travel + sparkle * core * 1.4;
    gl_FragColor = vec4(uColor * intensity * fade, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function tagTexture(name: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 112
  const context = canvas.getContext('2d')
  if (context) {
    const label = `${possessive(name).slice(0, 18)} LINE`
    context.font = '800 50px Inter, -apple-system, BlinkMacSystemFont, sans-serif'
    const width = Math.min(496, context.measureText(label).width + 84)
    const x = (512 - width) / 2
    context.fillStyle = 'rgba(4, 16, 24, 0.62)'
    context.beginPath()
    context.roundRect(x, 16, width, 80, 40)
    context.fill()
    context.strokeStyle = 'rgba(120, 236, 255, 0.9)'
    context.lineWidth = 3
    context.stroke()
    context.fillStyle = '#dffbff'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(label, 256 + 12, 58)
    context.strokeStyle = 'rgba(160, 244, 255, 0.95)'
    context.lineWidth = 5
    context.beginPath()
    context.moveTo(x + 26, 58)
    context.lineTo(x + 44, 58)
    context.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export interface GhostlineFrame {
  /** Courier distance on screen, metres. */
  viewDist: number
  time: number
  /** 0..1, smoothed: how strongly the courier is drafting the line. */
  drafting: number
}

export class GhostlineField {
  readonly group = new THREE.Group()
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.ShaderMaterial
  private readonly tagMaterial: THREE.SpriteMaterial
  private readonly tagTexture: THREE.CanvasTexture
  private readonly tag: THREE.Sprite
  private readonly length: number

  constructor(
    private readonly route: Route,
    private readonly ghostline: relayLeg.Ghostline,
    /** Whose line it is; without a name the line is drawn untagged. */
    private readonly name: string | null,
  ) {
    this.group.name = 'ghostline'
    this.length = ghostlineLength(ghostline)
    const count = Math.max(2, Math.floor(this.length / SPACING) + 1)
    const positions = new Float32Array(count * 2 * 3)
    const dists = new Float32Array(count * 2)
    const across = new Float32Array(count * 2)
    const indices: number[] = []
    const point = new THREE.Vector3()
    for (let i = 0; i < count; i++) {
      const d = Math.min(this.length, i * SPACING)
      const lateral = ghostlineLateral(ghostline, route, d) ?? 0
      for (let side = 0; side < 2; side++) {
        route.point(d, lateral + (side === 0 ? -HALF_WIDTH : HALF_WIDTH), LIFT, point)
        const v = i * 2 + side
        positions.set([point.x, point.y, point.z], v * 3)
        dists[v] = d
        across[v] = side === 0 ? -1 : 1
      }
      if (i > 0) {
        const a = (i - 1) * 2
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.geometry.setAttribute('aDist', new THREE.BufferAttribute(dists, 1))
    this.geometry.setAttribute('aAcross', new THREE.BufferAttribute(across, 1))
    this.geometry.setIndex(indices)
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uColor: { value: GHOST_CYAN.clone().multiplyScalar(0.62) }, uView: { value: 0 }, uTime: { value: 0 }, uDraft: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -6,
      side: THREE.DoubleSide,
    })
    const ribbon = new THREE.Mesh(this.geometry, this.material)
    ribbon.name = 'ghostline-ribbon'
    ribbon.frustumCulled = false
    ribbon.renderOrder = 2
    this.group.add(ribbon)

    this.tagTexture = tagTexture(name ?? '')
    this.tagMaterial = new THREE.SpriteMaterial({ map: this.tagTexture, transparent: true, depthWrite: false, fog: false })
    this.tag = new THREE.Sprite(this.tagMaterial)
    const tagLateral = ghostlineLateral(ghostline, route, TAG_DIST) ?? 0
    const side = tagLateral >= 0 ? -1 : 1
    route.point(TAG_DIST, tagLateral + side * TAG_SIDE, TAG_HEIGHT, this.tag.position)
    this.tag.scale.set(TAG_WIDTH, TAG_WIDTH * (112 / 512), 1)
    this.tag.renderOrder = 3
    this.tag.visible = name !== null && this.length > TAG_DIST
    this.group.add(this.tag)
  }

  update(frame: GhostlineFrame): void {
    const uniforms = this.material.uniforms
    uniforms.uView!.value = frame.viewDist
    uniforms.uTime!.value = frame.time
    uniforms.uDraft!.value = Math.max(0, Math.min(1, frame.drafting))
    const toTag = TAG_DIST - frame.viewDist
    const opacity = THREE.MathUtils.smoothstep(toTag, 3, 9) * (1 - THREE.MathUtils.smoothstep(toTag, 90, 140))
    this.tagMaterial.opacity = opacity
    this.tag.visible = this.name !== null && opacity > 0.01 && this.length > TAG_DIST
  }

  /** World position on the line at `d` metres, slightly above the deck, or null past its end. */
  pointAt(d: number, height: number, out: THREE.Vector3): THREE.Vector3 | null {
    const lateral = ghostlineLateral(this.ghostline, this.route, d)
    return lateral === null ? null : this.route.point(d, lateral, height, out)
  }

  dispose(): void {
    this.group.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
    this.tagMaterial.dispose()
    this.tagTexture.dispose()
  }
}
