import * as THREE from 'three'

/**
 * Lights chasing along bridge cables: pulses of warm light run up one span and
 * down the next, one point cloud per bridge. Positions are recomputed from the
 * cable polylines each frame into a fixed buffer, so nothing allocates.
 */

const LIGHTS_PER_CABLE = 22
const SPEED = 38

const vertex = /* glsl */ `
  attribute float aGlow;
  uniform float uScale;
  varying float vGlow;
  void main() {
    vGlow = aGlow;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(uScale * 1.6 / max(1.0, -mvPosition.z), 2.0, 22.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const fragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vGlow;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float core = pow(max(0.0, 1.0 - r), 2.5);
    gl_FragColor = vec4(uColor * core * vGlow, 1.0);
  }
`

interface Cable {
  points: readonly THREE.Vector3[]
  lengths: Float32Array
  total: number
}

export interface ChaseLights {
  points: THREE.Points
  update(time: number, visible: boolean): void
  dispose(): void
}

export function createChaseLights(cables: readonly (readonly THREE.Vector3[])[], color: THREE.Color): ChaseLights {
  const prepared: Cable[] = cables.filter(points => points.length > 1).map(points => {
    const lengths = new Float32Array(points.length)
    for (let i = 1; i < points.length; i++) lengths[i] = lengths[i - 1]! + points[i]!.distanceTo(points[i - 1]!)
    return { points, lengths, total: lengths[points.length - 1]! }
  })
  const count = prepared.length * LIGHTS_PER_CABLE
  const positions = new Float32Array(count * 3)
  const glow = new Float32Array(count)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1).setUsage(THREE.DynamicDrawUsage))
  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: color }, uScale: { value: 180 } },
  })
  const points = new THREE.Points(geometry, material)
  points.name = 'chase-lights'
  points.frustumCulled = false
  const probe = new THREE.Vector3()

  const sample = (cable: Cable, distance: number, out: THREE.Vector3): THREE.Vector3 => {
    let index = 1
    while (index < cable.points.length - 1 && cable.lengths[index]! < distance) index++
    const start = cable.lengths[index - 1]!
    const span = Math.max(1e-4, cable.lengths[index]! - start)
    return out.lerpVectors(cable.points[index - 1]!, cable.points[index]!, Math.min(1, Math.max(0, (distance - start) / span)))
  }

  return {
    points,
    update(time, visible) {
      points.visible = visible && count > 0
      if (!points.visible) return
      let cursor = 0
      for (let c = 0; c < prepared.length; c++) {
        const cable = prepared[c]!
        for (let k = 0; k < LIGHTS_PER_CABLE; k++) {
          const along = (((time * SPEED + (k / LIGHTS_PER_CABLE) * cable.total + c * 17) % cable.total) + cable.total) % cable.total
          sample(cable, along, probe)
          positions[cursor * 3] = probe.x
          positions[cursor * 3 + 1] = probe.y
          positions[cursor * 3 + 2] = probe.z
          glow[cursor] = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(k * 1.7 + time * 3), 3)
          cursor++
        }
      }
      geometry.attributes.position!.needsUpdate = true
      geometry.attributes.aGlow!.needsUpdate = true
    },
    dispose() {
      points.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
