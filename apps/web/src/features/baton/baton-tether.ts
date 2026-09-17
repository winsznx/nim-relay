import * as THREE from 'three'

/**
 * A strand of the baton's energy between two points: the short leash that keeps a carried baton
 * bound to its runner, and the long golden line that snaps out and hauls a falling runner back
 * onto the deck. A camera-facing ribbon along a drooping curve, with pulses running from the
 * baton end to the far end. Buffers are allocated once; nothing allocates per frame.
 */

const SEGMENTS = 24

const vertexShader = /* glsl */ `
  attribute float aAlong;
  attribute float aSide;
  varying float vAlong;
  varying float vSide;
  void main() {
    vAlong = aAlong;
    vSide = aSide;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uStrength;
  uniform float uReach;
  uniform float uFlicker;
  varying float vAlong;
  varying float vSide;
  void main() {
    if (vAlong > uReach) discard;
    float across = 1.0 - abs(vSide);
    float core = across * across * across;
    float pulse = pow(0.5 + 0.5 * sin((vAlong * 5.0 - uTime * 3.2) * 6.2831), 10.0);
    float ends = smoothstep(0.0, 0.06, vAlong) * (1.0 - smoothstep(uReach - 0.05, uReach, vAlong) * 0.6);
    float stutter = 1.0 - uFlicker * step(0.5, fract(uTime * 17.0 + vAlong * 3.0)) * 0.8;
    gl_FragColor = vec4(uColor * core * (0.55 + 1.1 * pulse) * ends * uStrength * stutter, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export interface TetherPose {
  /** Metres the middle of the strand hangs below the straight line between its ends. */
  sag: number
  /** 0..1 brightness. 0 hides the strand. */
  strength: number
  /** 0..1 of the strand drawn out from `from`, for the snap as it shoots out. */
  reach?: number
  /** Ribbon width in metres. */
  width?: number
  /** 0..1 destabilised: the strand stutters and kinks. */
  flicker?: number
  time: number
  cameraPosition: THREE.Vector3
}

export class BatonTether {
  readonly mesh: THREE.Mesh
  private readonly positions: Float32Array
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.ShaderMaterial
  private readonly control = new THREE.Vector3()
  private readonly point = new THREE.Vector3()
  private readonly tangent = new THREE.Vector3()
  private readonly toCamera = new THREE.Vector3()
  private readonly side = new THREE.Vector3()

  constructor(color: THREE.Color = new THREE.Color(2.6, 1.55, 0.42)) {
    const vertices = (SEGMENTS + 1) * 2
    this.positions = new Float32Array(vertices * 3)
    const along = new Float32Array(vertices)
    const sides = new Float32Array(vertices)
    const indices: number[] = []
    for (let i = 0; i <= SEGMENTS; i++) {
      along[i * 2] = i / SEGMENTS
      along[i * 2 + 1] = i / SEGMENTS
      sides[i * 2] = -1
      sides[i * 2 + 1] = 1
      if (i < SEGMENTS) {
        const a = i * 2
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('aAlong', new THREE.BufferAttribute(along, 1))
    this.geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1))
    this.geometry.setIndex(indices)
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColor: { value: color.clone() },
        uTime: { value: 0 },
        uStrength: { value: 0 },
        uReach: { value: 1 },
        uFlicker: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.name = 'baton-tether'
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 9
    this.mesh.visible = false
  }

  /** Draws the strand from `from` (the baton) to `to`. */
  update(from: THREE.Vector3, to: THREE.Vector3, pose: TetherPose): void {
    const strength = Math.max(0, Math.min(1.5, pose.strength))
    this.mesh.visible = strength > 0.01
    if (!this.mesh.visible) return
    const flicker = Math.max(0, Math.min(1, pose.flicker ?? 0))
    const uniforms = this.material.uniforms
    uniforms.uTime!.value = pose.time
    uniforms.uStrength!.value = strength
    uniforms.uReach!.value = Math.max(0, Math.min(1, pose.reach ?? 1))
    uniforms.uFlicker!.value = flicker

    this.control.copy(from).lerp(to, 0.5)
    this.control.y -= pose.sag * 2
    if (flicker > 0) {
      const kink = flicker * 0.08
      this.control.x += Math.sin(pose.time * 53) * kink
      this.control.z += Math.cos(pose.time * 47) * kink
    }
    const halfWidth = (pose.width ?? 0.035) / 2
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS
      this.sample(from, to, t, this.point)
      this.tangentAt(from, to, t, this.tangent)
      this.toCamera.subVectors(pose.cameraPosition, this.point)
      this.side.crossVectors(this.tangent, this.toCamera)
      const length = this.side.length()
      if (length > 1e-6) this.side.multiplyScalar(halfWidth / length)
      else this.side.set(halfWidth, 0, 0)
      const o = i * 6
      this.positions[o] = this.point.x - this.side.x
      this.positions[o + 1] = this.point.y - this.side.y
      this.positions[o + 2] = this.point.z - this.side.z
      this.positions[o + 3] = this.point.x + this.side.x
      this.positions[o + 4] = this.point.y + this.side.y
      this.positions[o + 5] = this.point.z + this.side.z
    }
    this.geometry.attributes.position!.needsUpdate = true
  }

  hide(): void {
    this.mesh.visible = false
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
  }

  /** Quadratic curve through the drooping control point. */
  private sample(from: THREE.Vector3, to: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
    const a = (1 - t) * (1 - t)
    const b = 2 * (1 - t) * t
    const c = t * t
    return out.set(a * from.x + b * this.control.x + c * to.x, a * from.y + b * this.control.y + c * to.y, a * from.z + b * this.control.z + c * to.z)
  }

  /** Direction of the curve at `t` (unnormalised derivative). */
  private tangentAt(from: THREE.Vector3, to: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
    const c = this.control
    return out.set(
      (1 - t) * (c.x - from.x) + t * (to.x - c.x),
      (1 - t) * (c.y - from.y) + t * (to.y - c.y),
      (1 - t) * (c.z - from.z) + t * (to.z - c.z),
    )
  }
}
