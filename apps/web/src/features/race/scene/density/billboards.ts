import * as THREE from 'three'
import type { Route } from '../route'

/**
 * Animated holographic billboards on masts beside the route: abstract light
 * panels that scroll colour bands and pulse, one instanced mesh for every
 * panel on the route. They add motion to the skyline without words competing
 * with the road signs.
 */

export interface BillboardSpec {
  /** Metres between panels along the route. */
  spacing: number
  minLateral: number
  maxLateral: number
  /** Panel centre height above the route deck, metres. */
  height: number
  palette: readonly THREE.Color[]
}

const vertex = /* glsl */ `
  #include <fog_pars_vertex>
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vSeed;
  void main() {
    vUv = uv;
    vColor = instanceColor;
    vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const fragment = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vSeed;
  void main() {
    vec2 uv = vUv;
    float bands = step(0.5, fract(uv.y * 5.0 - uTime * (0.3 + vSeed * 0.5)));
    float bars = smoothstep(0.35, 0.4, fract(uv.x * (2.0 + floor(vSeed * 4.0)) + uTime * 0.2 * sign(vSeed - 0.5)));
    float frame = step(uv.x, 0.03) + step(0.97, uv.x) + step(uv.y, 0.05) + step(0.95, uv.y);
    float pulse = 0.65 + 0.35 * sin(uTime * (1.5 + vSeed * 2.0) + vSeed * 20.0);
    vec3 color = vColor * (mix(0.25, 1.0, bands * bars) * pulse + min(frame, 1.0) * 0.9);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

export interface Billboards {
  mesh: THREE.InstancedMesh
  update(time: number): void
  dispose(): void
}

export function createBillboards(route: Route, spec: BillboardSpec, density: number, random: () => number): Billboards {
  const placements: { position: THREE.Vector3; yaw: number; width: number; tall: number; color: THREE.Color }[] = []
  const probe = new THREE.Vector3()
  for (let d = route.minDist + spec.spacing / 2; d < route.maxDist; d += spec.spacing) {
    for (const side of [-1, 1] as const) {
      if (random() > density) continue
      const lateral = side * (spec.minLateral + random() * (spec.maxLateral - spec.minLateral))
      const along = d + (random() - 0.5) * spec.spacing * 0.5
      route.flatPoint(along, lateral, probe)
      const deck = route.point(along, 0, 0, new THREE.Vector3()).y
      const facing = -route.headingAt(along) + (side === -1 ? -Math.PI / 2 : Math.PI / 2) + (random() - 0.5) * 0.5
      placements.push({
        position: new THREE.Vector3(probe.x, deck + spec.height + random() * 18, probe.z),
        yaw: facing,
        width: 9 + random() * 10,
        tall: 4 + random() * 6,
        color: spec.palette[Math.floor(random() * spec.palette.length)]!,
      })
    }
  }
  const geometry = new THREE.PlaneGeometry(1, 1)
  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
  })
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, placements.length))
  mesh.name = 'density-billboards'
  mesh.count = placements.length
  mesh.visible = placements.length > 0
  mesh.frustumCulled = false
  const transform = new THREE.Object3D()
  placements.forEach((placement, index) => {
    transform.position.copy(placement.position)
    transform.rotation.set(0, placement.yaw, 0)
    transform.scale.set(placement.width, placement.tall, 1)
    transform.updateMatrix()
    mesh.setMatrixAt(index, transform.matrix)
    mesh.setColorAt(index, placement.color)
  })
  return {
    mesh,
    update(time) {
      material.uniforms.uTime!.value = time
    },
    dispose() {
      mesh.removeFromParent()
      mesh.dispose()
      geometry.dispose()
      material.dispose()
    },
  }
}
