import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { COLOR } from './palette'
import type { QualitySettings } from './quality'
import { LIGHT_TAGS, createLightLineMaterial, createRadialTexture, type SharedUniforms } from './shaders'

export interface Disposable {
  dispose(): void
}

export interface StaticBatch {
  /** Bakes `geometry` at `matrix` into the batch and takes ownership of it. */
  add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, tag?: number): void
}

export interface StationMaterials {
  structure: THREE.MeshStandardMaterial
  structureDeep: THREE.MeshStandardMaterial
  stone: THREE.MeshStandardMaterial
  goldMetal: THREE.MeshStandardMaterial
  lights: THREE.ShaderMaterial
}

/**
 * Resources shared across the station for one mount: quality settings, shared
 * uniforms and materials, and static batches that merge fixed architecture into
 * a single draw per material.
 */
export interface StationKit {
  readonly settings: QualitySettings
  readonly renderer: THREE.WebGLRenderer
  readonly uniforms: SharedUniforms
  readonly materials: StationMaterials
  readonly radial: THREE.CanvasTexture
  readonly structure: StaticBatch
  readonly stone: StaticBatch
  readonly lights: StaticBatch
  track<T extends Disposable>(resource: T): T
  /** Merges each batch into one mesh. Call once, after every surface has added its parts. */
  buildBatches(parent: THREE.Object3D): void
  setLightGlow(tag: number, glow: number): void
  dispose(): void
}

interface BatchState extends StaticBatch {
  take(): THREE.BufferGeometry[]
}

function createBatch(tagged: boolean): BatchState {
  let parts: THREE.BufferGeometry[] = []
  return {
    add(geometry, matrix, tag = 0) {
      const part = geometry.index ? geometry.toNonIndexed() : geometry.clone()
      geometry.dispose()
      for (const name of Object.keys(part.attributes)) {
        if (name !== 'position' && name !== 'normal') part.deleteAttribute(name)
      }
      part.clearGroups()
      part.applyMatrix4(matrix)
      if (tagged) part.setAttribute('aTag', new THREE.BufferAttribute(new Float32Array(part.getAttribute('position').count).fill(tag), 1))
      parts.push(part)
    },
    take() {
      const taken = parts
      parts = []
      return taken
    },
  }
}

export function createKit(renderer: THREE.WebGLRenderer, settings: QualitySettings): StationKit {
  const resources = new Set<Disposable>()
  const track = <T extends Disposable>(resource: T): T => {
    resources.add(resource)
    return resource
  }

  const uniforms: SharedUniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
    uFogColor: { value: COLOR.fog.clone() },
    uFogDensity: { value: 0.0026 },
  }
  const glow = new Float32Array(LIGHT_TAGS)
  const materials: StationMaterials = {
    structure: track(new THREE.MeshStandardMaterial({ color: COLOR.graphite, roughness: 0.42, metalness: 0.62 })),
    structureDeep: track(new THREE.MeshStandardMaterial({ color: COLOR.graphiteDeep, roughness: 0.66, metalness: 0.4 })),
    stone: track(new THREE.MeshStandardMaterial({ color: COLOR.stone, roughness: 0.78, metalness: 0.12 })),
    goldMetal: track(new THREE.MeshStandardMaterial({ color: '#c28a2f', roughness: 0.3, metalness: 1, emissive: '#2b1603', emissiveIntensity: 1 })),
    lights: track(createLightLineMaterial(uniforms, glow)),
  }

  const batches = {
    structure: createBatch(false),
    stone: createBatch(false),
    lights: createBatch(true),
  }

  function merge(batch: BatchState, material: THREE.Material, parent: THREE.Object3D, shadows: boolean): void {
    const parts = batch.take()
    if (parts.length === 0) return
    const merged = mergeGeometries(parts, false)
    for (const part of parts) part.dispose()
    if (!merged) return
    track(merged)
    const mesh = new THREE.Mesh(merged, material)
    mesh.matrixAutoUpdate = false
    mesh.receiveShadow = shadows
    mesh.castShadow = shadows
    parent.add(mesh)
  }

  return {
    settings,
    renderer,
    uniforms,
    materials,
    radial: track(createRadialTexture()),
    structure: batches.structure,
    stone: batches.stone,
    lights: batches.lights,
    track,
    buildBatches(parent) {
      merge(batches.structure, materials.structure, parent, settings.shadows)
      merge(batches.stone, materials.stone, parent, settings.shadows)
      merge(batches.lights, materials.lights, parent, false)
    },
    setLightGlow(tag, value) {
      if (tag >= 0 && tag < glow.length) glow[tag] = value
    },
    dispose() {
      for (const batch of Object.values(batches)) for (const part of batch.take()) part.dispose()
      for (const resource of resources) resource.dispose()
      resources.clear()
    },
  }
}
