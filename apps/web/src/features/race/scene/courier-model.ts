import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

/**
 * Loads the CC0 Quaternius courier bodies (see scripts/assets/build-courier-v5.mjs)
 * and prepares them for the race: bind-pose attributes that let the suit shader
 * draw panels, gloves, boots and light lines without textures.
 */

export type CourierBody = 'male' | 'female'

export interface CourierAssets {
  bodies: Record<CourierBody, GLTF>
  clips: readonly THREE.AnimationClip[]
}

const ASSET_URLS: Record<CourierBody, string> = {
  male: '/assets/courier-v5.glb',
  female: '/assets/courier-v5-female.glb',
}

let pending: Promise<CourierAssets> | null = null

export function loadCourierAssets(): Promise<CourierAssets> {
  if (!pending) {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    pending = Promise.all([loader.loadAsync(ASSET_URLS.male), loader.loadAsync(ASSET_URLS.female)])
      .then(([male, female]) => {
        prepareBody(male)
        prepareBody(female)
        return { bodies: { male, female }, clips: male.animations }
      })
      .catch((error: unknown) => {
        pending = null
        throw error
      })
  }
  return pending
}

/** Region ids written to `aRegion`, keyed off each vertex's dominant bone. */
export const REGION = { suit: 0, glove: 1, boot: 2, head: 3 } as const

function regionForBone(name: string): number {
  if (/^(hand|thumb|index|middle|ring|pinky)/.test(name)) return REGION.glove
  if (/^(foot|ball)/.test(name)) return REGION.boot
  if (/^(head|neck)/i.test(name)) return REGION.head
  return REGION.suit
}

function findSkinned(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null
  root.traverse(object => {
    if (!found && object instanceof THREE.SkinnedMesh) found = object
  })
  return found
}

/** Adds `aBind` (bind-pose position in metres, body facing +Z) and `aRegion` to the body geometry. */
function prepareBody(gltf: GLTF): void {
  gltf.scene.updateMatrixWorld(true)
  const mesh = findSkinned(gltf.scene)
  if (!mesh || mesh.geometry.getAttribute('aBind')) return
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  const joints = geometry.getAttribute('skinIndex')
  const weights = geometry.getAttribute('skinWeight')
  const skeleton = mesh.skeleton
  const boneMatrices = skeleton.bones.map((bone, index) => new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, skeleton.boneInverses[index]!))
  const regions = skeleton.bones.map(bone => regionForBone(bone.name))
  const bind = new Float32Array(position.count * 3)
  const region = new Float32Array(position.count)
  const local = new THREE.Vector3()
  const skinned = new THREE.Vector3()
  const accumulated = new THREE.Vector3()
  for (let i = 0; i < position.count; i++) {
    local.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix)
    accumulated.set(0, 0, 0)
    let dominant = 0
    let dominantWeight = -1
    for (let k = 0; k < 4; k++) {
      const weight = weights.getComponent(i, k)
      if (weight <= 0) continue
      const joint = joints.getComponent(i, k)
      skinned.copy(local).applyMatrix4(boneMatrices[joint]!)
      accumulated.addScaledVector(skinned, weight)
      if (weight > dominantWeight) {
        dominantWeight = weight
        dominant = joint
      }
    }
    accumulated.applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld)
    bind[i * 3] = accumulated.x
    bind[i * 3 + 1] = accumulated.y
    bind[i * 3 + 2] = accumulated.z
    region[i] = regions[dominant] ?? REGION.suit
  }
  geometry.setAttribute('aBind', new THREE.BufferAttribute(bind, 3))
  geometry.setAttribute('aRegion', new THREE.BufferAttribute(region, 1))
}

export interface SuitColors {
  suit: THREE.Color
  panel: THREE.Color
  armor: THREE.Color
  light: THREE.Color
  rim: THREE.Color
  /** View-facing fill so the courier reads against dark worlds without lighting the whole scene. */
  fill: THREE.Color
}

/** Racing suit drawn from bind-pose position: armour plates, gloves, boots and gold light lines. */
export function createSuitMaterial(colors: SuitColors): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.48, metalness: 0.2 })
  const uniforms = {
    uSuit: { value: colors.suit },
    uPanel: { value: colors.panel },
    uArmor: { value: colors.armor },
    uLight: { value: colors.light },
    uRim: { value: colors.rim },
    uFill: { value: colors.fill },
  }
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aBind;\nattribute float aRegion;\nvarying vec3 vBind;\nvarying float vRegion;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = aBind;\nvRegion = aRegion;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform vec3 uSuit;',
          'uniform vec3 uPanel;',
          'uniform vec3 uArmor;',
          'uniform vec3 uLight;',
          'uniform vec3 uRim;',
          'uniform vec3 uFill;',
          'varying vec3 vBind;',
          'varying float vRegion;',
        ].join('\n'),
      )
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'vec3 suitColor = uSuit;',
          'float ax = abs(vBind.x);',
          'float plate = step(1.16, vBind.y) * step(vBind.y, 1.47) * step(ax, 0.2);',
          'float shoulder = step(1.36, vBind.y) * step(0.16, ax) * step(ax, 0.3);',
          'float knee = step(0.42, vBind.y) * step(vBind.y, 0.6) * step(0.02, vBind.z);',
          'float shin = step(0.12, vBind.y) * step(vBind.y, 0.42);',
          'float armor = max(max(plate * 0.85, shoulder), max(knee, shin * 0.9));',
          'armor = max(armor, step(0.5, vRegion) * step(vRegion, 2.5));',
          'suitColor = mix(suitColor, uPanel, step(0.72, vBind.y) * step(vBind.y, 1.0) * step(0.1, ax) * 0.6);',
          'suitColor = mix(suitColor, uArmor, armor);',
          'diffuseColor.rgb = suitColor;',
          'float suitArmor = armor;',
        ].join('\n'),
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.72, 0.26, suitArmor);',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\nmetalnessFactor = mix(0.04, 0.72, suitArmor);',
      )
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          '{',
          '  float legLine = step(0.3, vBind.y) * step(vBind.y, 0.92) * (1.0 - smoothstep(0.004, 0.009, abs(ax - 0.165)));',
          '  float armLine = step(0.3, ax) * step(ax, 0.66) * (1.0 - smoothstep(0.005, 0.01, abs(vBind.y - 1.5)));',
          '  float spine = step(0.9, vBind.y) * step(vBind.y, 1.46) * step(vBind.z, -0.06) * (1.0 - smoothstep(0.006, 0.012, ax));',
          '  float collar = step(1.47, vBind.y) * step(vBind.y, 1.5) * step(ax, 0.12);',
          '  totalEmissiveRadiance += uLight * max(max(legLine, armLine), max(spine, collar));',
          '  float facing = saturate(dot(normal, normalize(vViewPosition)));',
          '  totalEmissiveRadiance += uRim * pow(1.0 - facing, 2.6);',
          '  totalEmissiveRadiance += diffuseColor.rgb * uFill * (0.25 + 0.75 * facing);',
          '}',
        ].join('\n'),
      )
  }
  material.customProgramCacheKey = () => 'courier-suit'
  return material
}

const ghostVertex = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  varying vec3 vNormalView;
  varying vec3 vViewPosition;
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    #include <project_vertex>
    vNormalView = normalize(transformedNormal);
    vViewPosition = -mvPosition.xyz;
  }
`

const ghostFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  varying vec3 vNormalView;
  varying vec3 vViewPosition;
  void main() {
    float facing = abs(dot(normalize(vNormalView), normalize(vViewPosition)));
    float rim = pow(1.0 - facing, 2.4);
    float scan = 0.82 + 0.18 * sin(vViewPosition.y * 34.0 + uTime * 5.0);
    float nearFade = smoothstep(1.4, 4.0, length(vViewPosition));
    gl_FragColor = vec4(uColor * (0.08 + rim * 1.25) * scan * nearFade, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function createGhostMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: ghostVertex,
    fragmentShader: ghostFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(0.3, 1.05, 1.3) }, uTime: { value: 0 } },
  })
}

export interface BodyInstance {
  root: THREE.Object3D
  mesh: THREE.SkinnedMesh
  bone(name: string): THREE.Bone | null
}

export function instantiateBody(assets: CourierAssets, body: CourierBody): BodyInstance {
  const root = cloneSkinned(assets.bodies[body].scene)
  const mesh = findSkinned(root)
  if (!mesh) throw new Error('Courier asset has no skinned mesh')
  const bones = new Map(mesh.skeleton.bones.map(bone => [bone.name, bone]))
  return { root, mesh, bone: name => bones.get(name) ?? null }
}
