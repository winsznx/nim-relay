import * as THREE from 'three'
import { MeshBuilder } from '../mesh-builder'
import { createRouteFrame, fromQ, type Route } from '../route'
import { spansAt } from '../track-spans'

/**
 * The handoff gate: a giant hexagonal portal over the finish with a launch
 * platform beyond it and a pillar of gold light that is visible from the start
 * line. It comes alive as the courier approaches and during the ceremony.
 */

export const GATE_OFFSET = 10
export const PLATFORM_FROM = 24
export const PLATFORM_TO = 44

const RING_RADIUS = 21
const RING_THICKNESS = 2.2
const RING_DEPTH = 2.4

export interface HandoffGate {
  group: THREE.Group
  /** World position at the lip of the launch platform, where the baton leaves. */
  launchPoint: THREE.Vector3
  update(time: number, finale: number): void
  dispose(): void
}

function hexRing(builder: MeshBuilder, radius: number, thickness: number, depth: number, color: THREE.Color, inner: THREE.Color): void {
  const corners = (r: number, z: number): THREE.Vector3[] =>
    Array.from({ length: 6 }, (_, i) => {
      const angle = (i / 6) * Math.PI * 2 + Math.PI / 6
      return new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z)
    })
  const outerFront = corners(radius + thickness, depth / 2)
  const outerBack = corners(radius + thickness, -depth / 2)
  const innerFront = corners(radius, depth / 2)
  const innerBack = corners(radius, -depth / 2)
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6
    builder.quad(innerFront[i]!, outerFront[i]!, outerFront[j]!, innerFront[j]!, color)
    builder.quad(outerBack[i]!, innerBack[i]!, innerBack[j]!, outerBack[j]!, color)
    builder.quad(outerFront[i]!, outerBack[i]!, outerBack[j]!, outerFront[j]!, color)
    builder.quad(innerBack[i]!, innerFront[i]!, innerFront[j]!, innerBack[j]!, inner)
  }
}

/**
 * A flat hexagonal band of light on one face of the ring (both sides of the
 * band, so it reads from the start line and from the platform). Only faces
 * carry light: the ring's inner and outer walls stay dark, so the camera never
 * sees a wall of glow when it circles the courier under the gate.
 */
function hexRim(builder: MeshBuilder, radius: number, width: number, z: number, color: THREE.Color): void {
  const corners = (r: number): THREE.Vector3[] =>
    Array.from({ length: 6 }, (_, i) => {
      const angle = (i / 6) * Math.PI * 2 + Math.PI / 6
      return new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z)
    })
  const inner = corners(radius)
  const outer = corners(radius + width)
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6
    builder.quad(inner[i]!, outer[i]!, outer[j]!, inner[j]!, color)
    builder.quad(outer[i]!, inner[i]!, inner[j]!, outer[j]!, color)
  }
}

export function createHandoffGate(route: Route, floorY: number): HandoffGate {
  const group = new THREE.Group()
  group.name = 'handoff-gate'
  const frame = createRouteFrame()
  const finish = fromQ(route.track.finishDist)
  const gateDist = finish + GATE_OFFSET
  route.frame(gateDist, frame)
  const deck = route.point(gateDist, 0, 0, new THREE.Vector3())

  const structure = new MeshBuilder()
  const glow = new MeshBuilder()
  const dark = new THREE.Color('#1c1d24')
  const trim = new THREE.Color('#3a3326')
  const gold = new THREE.Color(2.2, 1.2, 0.28)
  const hot = new THREE.Color(3.4, 2.2, 0.9)

  const ringGroup = new THREE.Group()
  ringGroup.position.copy(deck).addScaledVector(frame.up, RING_RADIUS - 4)
  ringGroup.quaternion.copy(frame.quaternion)
  group.add(ringGroup)
  ringGroup.updateMatrix()

  const ringBuilder = new MeshBuilder()
  hexRing(ringBuilder, RING_RADIUS, RING_THICKNESS, RING_DEPTH, dark, dark)
  const ringLight = new MeshBuilder()
  for (const face of [-1, 1] as const) {
    ringLight.clear()
    hexRim(ringLight, RING_RADIUS - 0.05, 0.3, face * (RING_DEPTH / 2 + 0.02), gold)
    const rimGeometry = ringLight.build()
    glow.append(rimGeometry, ringGroup.matrix, gold)
    rimGeometry.dispose()
  }
  const innerRingLight = new MeshBuilder()
  hexRim(innerRingLight, RING_RADIUS * 0.72, 0.16, 0, hot)
  const ringGeometryLocal = ringBuilder.build()
  structure.append(ringGeometryLocal, ringGroup.matrix, dark)
  ringGeometryLocal.dispose()

  for (const side of [-1, 1] as const) {
    const lateral = side * (RING_RADIUS * 0.87 + 1)
    const top = route.point(gateDist, lateral, RING_RADIUS * 0.5 - 4, new THREE.Vector3())
    const bottom = new THREE.Vector3(top.x, floorY, top.z)
    const half = 1.6
    const right = frame.right
    const forward = frame.forward
    const corner = (base: THREE.Vector3, sx: number, sz: number): THREE.Vector3 =>
      base.clone().addScaledVector(right, sx * half).addScaledVector(forward, sz * half)
    const upper = [corner(top, -1, -1), corner(top, 1, -1), corner(top, 1, 1), corner(top, -1, 1)]
    const lower = [corner(bottom, -1.6, -1.6), corner(bottom, 1.6, -1.6), corner(bottom, 1.6, 1.6), corner(bottom, -1.6, 1.6)]
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      structure.quad(lower[i]!, lower[j]!, upper[j]!, upper[i]!, trim)
    }
    const stripA = top.clone().addScaledVector(right, -side * (half + 0.02)).addScaledVector(forward, -0.07)
    const stripB = top.clone().addScaledVector(right, -side * (half + 0.02)).addScaledVector(forward, 0.07)
    const stripC = new THREE.Vector3(stripB.x, deck.y - 6, stripB.z)
    const stripD = new THREE.Vector3(stripA.x, deck.y - 6, stripA.z)
    if (side === -1) glow.quad(stripA, stripD, stripC, stripB, gold)
    else glow.quad(stripB, stripC, stripD, stripA, gold)
  }

  const platformCentre = (PLATFORM_FROM + PLATFORM_TO) / 2
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const
  for (let ring = 0; ring < 4; ring++) {
    const radius = 3 + ring * 2.2
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2
      const a1 = ((i + 1) / 6) * Math.PI * 2
      const width = 0.12
      const at = (angle: number, r: number, out: THREE.Vector3): THREE.Vector3 =>
        route.point(finish + platformCentre + Math.cos(angle) * r, Math.sin(angle) * r, 0.04, out)
      glow.quad(at(a0, radius, p[0]), at(a1, radius, p[1]), at(a1, radius + width, p[2]), at(a0, radius + width, p[3]), ring === 0 ? hot : gold)
    }
  }
  for (const span of spansAt(route, finish + PLATFORM_TO - 0.5)) {
    glow.quad(
      route.point(finish + PLATFORM_TO - 0.6, span.left, 0.05, p[0]), route.point(finish + PLATFORM_TO - 0.6, span.right, 0.05, p[1]),
      route.point(finish + PLATFORM_TO, span.right, 0.05, p[2]), route.point(finish + PLATFORM_TO, span.left, 0.05, p[3]), hot,
    )
  }

  const structureGeometry = structure.build()
  const glowGeometry = glow.build()
  const innerGeometry = innerRingLight.build()
  const structureMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35, envMapIntensity: 0.5 })
  const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })
  group.add(new THREE.Mesh(structureGeometry, structureMaterial), new THREE.Mesh(glowGeometry, glowMaterial))
  const inner = new THREE.Mesh(innerGeometry, glowMaterial)
  ringGroup.add(inner)

  const beamGeometry = new THREE.CylinderGeometry(3.2, 5.5, 900, 6, 1, true)
  beamGeometry.translate(0, 450, 0)
  const beamMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: { uIntensity: { value: 0.6 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewPosition;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewPosition;
      void main() {
        float facing = abs(dot(normalize(vNormalView), normalize(vViewPosition)));
        float core = pow(facing, 2.5);
        float fade = pow(1.0 - vUv.y, 1.6);
        float near = smoothstep(90.0, 260.0, length(vViewPosition));
        float pulse = 0.85 + 0.15 * sin(uTime * 2.0 - vUv.y * 40.0);
        vec3 color = vec3(1.6, 0.95, 0.3) * core * fade * pulse * near * uIntensity;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  const beam = new THREE.Mesh(beamGeometry, beamMaterial)
  beam.position.copy(route.point(finish + PLATFORM_TO + 36, 0, -8, new THREE.Vector3()))
  beam.frustumCulled = false
  group.add(beam)

  const launchPoint = route.point(finish + PLATFORM_TO, 0, 1.8, new THREE.Vector3())

  return {
    group,
    launchPoint,
    update(time, finale) {
      const f = Math.max(0, Math.min(1, finale))
      inner.rotation.z = time * (0.25 + f * 0.6)
      inner.scale.setScalar(0.8 + f * 0.5)
      glowMaterial.color.setScalar(0.6 + f * 0.35 + Math.sin(time * 2.4) * 0.04)
      beamMaterial.uniforms.uIntensity!.value = 0.45 + f * 1.1
      beamMaterial.uniforms.uTime!.value = time
    },
    dispose() {
      group.removeFromParent()
      for (const geometry of [structureGeometry, glowGeometry, innerGeometry, beamGeometry]) geometry.dispose()
      for (const material of [structureMaterial, glowMaterial, beamMaterial]) material.dispose()
    },
  }
}
