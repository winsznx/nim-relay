import * as THREE from 'three'
import { createBodyMaterial, createFloorMaterial, createGustMaterial, createStripeMaterial, droneGeometry } from '../hazard-parts'
import { fadeNearCamera } from '../materials'
import { createRouteFrame, type Route } from '../route'

/**
 * Immediate-mode instancing for world events. Every frame each visible event
 * writes the pieces it needs into shared instanced meshes, one per part kind,
 * so all events together cost one draw call per kind in use no matter how many
 * are on screen. Beacons are diamond-turned lamps and share the lamp mesh; on
 * the low tier the purely decorative kinds are skipped. Nothing allocates per
 * frame.
 */

export type PartName =
  | 'body'
  | 'stripe'
  | 'lamp'
  | 'beacon'
  | 'spark'
  | 'floor'
  | 'wind'
  | 'cone'
  | 'rotor'
  | 'drone'

type MeshName = Exclude<PartName, 'beacon'>

const CAPACITY: Readonly<Record<MeshName, number>> = {
  body: 240,
  stripe: 96,
  lamp: 320,
  spark: 160,
  floor: 32,
  wind: 48,
  cone: 16,
  rotor: 32,
  drone: 8,
}

/** Kinds that only dress an event; its telegraph and blocking read without them. */
const DECORATIVE: ReadonlySet<PartName> = new Set<PartName>(['spark', 'cone', 'rotor'])
/** A box turned onto its corners, so a lamp reads as a beacon diamond. */
const DIAMOND = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 4, 0, Math.PI / 4))
const DIAMOND_SCALE = 0.62

const sparkVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  void main() {
    vUv = uv;
    vColor = instanceColor;
    vec4 centre = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
    centre.xy += position.xy * length(instanceMatrix[0].xyz);
    gl_Position = projectionMatrix * centre;
  }
`

const sparkFragment = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float glow = pow(max(0.0, 1.0 - r), 2.2);
    gl_FragColor = vec4(vColor * glow, 1.0);
  }
`

const coneVertex = /* glsl */ `
  varying float vAlong;
  varying vec3 vColor;
  varying vec3 vNormalView;
  varying vec3 vViewPosition;
  void main() {
    vAlong = uv.y;
    vColor = instanceColor;
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const coneFragment = /* glsl */ `
  varying float vAlong;
  varying vec3 vColor;
  varying vec3 vNormalView;
  varying vec3 vViewPosition;
  void main() {
    float facing = abs(dot(normalize(vNormalView), normalize(vViewPosition)));
    float beam = pow(facing, 1.6) * pow(vAlong, 1.5);
    gl_FragColor = vec4(vColor * beam, 1.0);
  }
`

function createSparkMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: sparkVertex, fragmentShader: sparkFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
}

function createConeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: coneVertex, fragmentShader: coneFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
}

interface Part {
  mesh: THREE.InstancedMesh
  cursor: number
}

export class EventParts {
  readonly group = new THREE.Group()
  private readonly parts: Record<MeshName, Part>
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly materials: THREE.Material[] = []
  private readonly timed: THREE.ShaderMaterial[] = []
  private readonly frame = createRouteFrame()
  private readonly matrix = new THREE.Matrix4()
  private readonly position = new THREE.Vector3()
  private readonly quaternion = new THREE.Quaternion()
  private readonly local = new THREE.Quaternion()
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private readonly scale = new THREE.Vector3()

  constructor(
    private readonly route: Route,
    private readonly detail: boolean,
  ) {
    this.group.name = 'world-events'
    const box = this.keep(new THREE.BoxGeometry(1, 1, 1))
    const lamp = new THREE.MeshBasicMaterial({ color: 0xffffff })
    fadeNearCamera(lamp, 'event-lamp')
    const rotor = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    const floor = createFloorMaterial()
    const wind = createGustMaterial()
    this.timed.push(floor, wind)
    const make = (name: MeshName, geometry: THREE.BufferGeometry, material: THREE.Material): Part => {
      if (!this.materials.includes(material)) this.materials.push(material)
      const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY[name])
      mesh.count = 0
      mesh.visible = false
      mesh.frustumCulled = false
      mesh.name = `event-${name}`
      mesh.setColorAt(0, new THREE.Color(1, 1, 1))
      this.group.add(mesh)
      return { mesh, cursor: 0 }
    }
    this.parts = {
      body: make('body', box, createBodyMaterial('event-body', 0xffffff, false)),
      stripe: make('stripe', box, createStripeMaterial({ cacheKey: 'event-stripe', stripe: null, glow: 0.35, body: new THREE.Color(0.62, 0.62, 0.6), rim: false })),
      lamp: make('lamp', box, lamp),
      spark: make('spark', this.keep(new THREE.PlaneGeometry(1, 1)), createSparkMaterial()),
      floor: make('floor', this.keep(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), floor),
      wind: make('wind', this.keep(new THREE.PlaneGeometry(1, 1)), wind),
      cone: make('cone', this.keep(new THREE.CylinderGeometry(0.02, 1, 1, 18, 1, true).translate(0, -0.5, 0)), createConeMaterial()),
      rotor: make('rotor', this.keep(new THREE.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2)), rotor),
      drone: make('drone', this.keep(droneGeometry()), createBodyMaterial('event-drone', 0xffffff)),
    }
  }

  private keep<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry)
    return geometry
  }

  begin(): void {
    for (const part of Object.values(this.parts)) part.cursor = 0
  }

  /**
   * One piece at route distance `d`, `lateral` metres from the main centre line
   * and `height` above the deck, sized `sx` across, `sy` up and `sz` along the
   * route, turned by yaw (about up), pitch (about across) and roll (about along).
   */
  put(name: PartName, d: number, lateral: number, height: number, sx: number, sy: number, sz: number, color: THREE.Color, yaw = 0, pitch = 0, roll = 0): void {
    if (!this.detail && DECORATIVE.has(name)) return
    const beacon = name === 'beacon'
    const part = this.parts[beacon ? 'lamp' : name]
    if (part.cursor >= part.mesh.instanceMatrix.count) return
    this.route.frame(d, this.frame)
    this.route.point(d, lateral, height, this.position)
    this.quaternion.copy(this.frame.quaternion)
    if (yaw !== 0 || pitch !== 0 || roll !== 0) this.quaternion.multiply(this.local.setFromEuler(this.euler.set(pitch, yaw, roll, 'YXZ')))
    if (beacon) {
      this.quaternion.multiply(DIAMOND)
      this.write(part, color, sx * DIAMOND_SCALE, sy * DIAMOND_SCALE, sz * DIAMOND_SCALE)
      return
    }
    this.write(part, color, sx, sy, sz)
  }

  private write(part: Part, color: THREE.Color, sx: number, sy: number, sz: number): void {
    this.scale.set(sx, sy, sz)
    part.mesh.setMatrixAt(part.cursor, this.matrix.compose(this.position, this.quaternion, this.scale))
    part.mesh.setColorAt(part.cursor, color)
    part.cursor++
  }

  end(time: number): void {
    for (const material of this.timed) material.uniforms.uTime!.value = time
    for (const part of Object.values(this.parts)) {
      const mesh = part.mesh
      mesh.count = part.cursor
      mesh.visible = part.cursor > 0
      if (part.cursor === 0) continue
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const part of Object.values(this.parts)) part.mesh.dispose()
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
  }
}
