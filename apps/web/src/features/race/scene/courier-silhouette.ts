import * as THREE from 'three'
import { applyPose, neutralPose, type PoseParams } from './courier-pose'
import { buildCourierRig, type CourierPalette } from './courier-rig'

/**
 * A courier frozen mid-move as one static geometry: the procedural rig posed
 * once and its skinning baked into plain positions and normals. Relay Echoes use
 * it to leave a runner's silhouette on the route where they made their save or
 * their cut, drawn with a single instanced call.
 */

const PALETTE: CourierPalette = {
  suit: new THREE.Color(1, 1, 1),
  suitPanel: new THREE.Color(1, 1, 1),
  armor: new THREE.Color(1, 1, 1),
  armorTrim: new THREE.Color(1, 1, 1),
  board: new THREE.Color(1, 1, 1),
  boardTrim: new THREE.Color(1, 1, 1),
  light: new THREE.Color(1, 1, 1),
  visorLight: new THREE.Color(1, 1, 1),
}

/** Bakes the procedural courier in `pose` (merged over the neutral riding pose). Local frame: -Z forward, +Y up. */
export function bakeCourierSilhouette(pose: Partial<PoseParams>): THREE.BufferGeometry {
  const rig = buildCourierRig(PALETTE)
  const posed: PoseParams = { ...neutralPose(), ...pose }
  applyPose(rig, posed, 0)
  rig.root.updateMatrixWorld(true)
  const bones = rig.skeleton.bones
  const skin = bones.map((bone, index) => new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, rig.skeleton.boneInverses[index]!))
  const normalMatrices = skin.map(matrix => new THREE.Matrix3().getNormalMatrix(matrix))

  const parts = Object.values(rig.geometries)
  let vertices = 0
  for (const part of parts) vertices += part.getAttribute('position').count
  const positions = new Float32Array(vertices * 3)
  const normals = new Float32Array(vertices * 3)
  const point = new THREE.Vector3()
  const normal = new THREE.Vector3()
  let offset = 0
  for (const part of parts) {
    const position = part.getAttribute('position')
    const partNormals = part.getAttribute('normal')
    const skinIndex = part.getAttribute('skinIndex')
    for (let i = 0; i < position.count; i++) {
      const bone = skinIndex.getX(i)
      point.fromBufferAttribute(position, i).applyMatrix4(skin[bone]!)
      normal.fromBufferAttribute(partNormals, i).applyMatrix3(normalMatrices[bone]!).normalize()
      positions.set([point.x, point.y, point.z], (offset + i) * 3)
      normals.set([normal.x, normal.y, normal.z], (offset + i) * 3)
    }
    offset += position.count
    part.dispose()
  }
  rig.skeleton.dispose()
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.computeBoundingSphere()
  return geometry
}

const vertexShader = /* glsl */ `
  varying vec3 vNormalView;
  varying vec3 vViewPosition;
  varying float vGlow;
  varying float vHeight;
  void main() {
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    vViewPosition = -mvPosition.xyz;
    vGlow = instanceColor.r;
    vHeight = position.y;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  varying vec3 vNormalView;
  varying vec3 vViewPosition;
  varying float vGlow;
  varying float vHeight;
  void main() {
    float facing = abs(dot(normalize(vNormalView), normalize(vViewPosition)));
    float rim = pow(1.0 - facing, 2.2);
    float scan = 0.8 + 0.2 * sin(vHeight * 42.0 - uTime * 4.0);
    float nearFade = smoothstep(1.5, 5.0, length(vViewPosition));
    gl_FragColor = vec4(uColor * (0.06 + rim * 1.1) * scan * nearFade * vGlow, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** Spectral gold for echo silhouettes: rim-lit, scan-lined, additive. Instance colour red carries the glow. */
export function createSilhouetteMaterial(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uColor: { value: color.clone() }, uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
}
