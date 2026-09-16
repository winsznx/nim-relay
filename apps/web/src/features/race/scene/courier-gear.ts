import * as THREE from 'three'
import { MeshBuilder } from './mesh-builder'

/**
 * Rigid gear worn by the courier: a racing helmet with a dark visor and gold
 * visor light, and the hoverboard with a glowing underside. Built in the body's
 * model space (+Y up, facing +Z) so it can be parented to bones at bind pose.
 * Parts are merged per material, so helmet and board draw in three calls each
 * (one each for the ghost).
 */

export interface GearColors {
  shell: THREE.Color
  trim: THREE.Color
  deck: THREE.Color
  light: THREE.Color
  rim: THREE.Color
  fill: THREE.Color
}

export interface Gear {
  helmet: THREE.Group
  board: THREE.Group
  /** Underside glow, brightened with FLOW. */
  boardGlow: THREE.MeshBasicMaterial
  dispose(): void
}

function roundedRect(width: number, length: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape()
  const x = -width / 2
  const y = -length / 2
  shape.moveTo(x + radius, y)
  shape.lineTo(x + width - radius, y)
  shape.quadraticCurveTo(x + width, y, x + width, y + radius)
  shape.lineTo(x + width, y + length - radius)
  shape.quadraticCurveTo(x + width, y + length, x + width - radius, y + length)
  shape.lineTo(x + radius, y + length)
  shape.quadraticCurveTo(x, y + length, x, y + length - radius)
  shape.lineTo(x, y + radius)
  shape.quadraticCurveTo(x, y, x + radius, y)
  return shape
}

function rimmed(material: THREE.MeshStandardMaterial, rim: THREE.Color, fill: THREE.Color): THREE.MeshStandardMaterial {
  const rimColor = { value: rim }
  const fillColor = { value: fill }
  material.onBeforeCompile = shader => {
    shader.uniforms.uGearRim = rimColor
    shader.uniforms.uGearFill = fillColor
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uGearRim;\nuniform vec3 uGearFill;')
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          'float gearFacing = saturate(dot(normal, normalize(vViewPosition)));',
          'totalEmissiveRadiance += uGearRim * pow(1.0 - gearFacing, 2.4) + diffuseColor.rgb * uGearFill * (0.25 + 0.75 * gearFacing);',
        ].join('\n'),
      )
  }
  material.customProgramCacheKey = () => 'gear-rim'
  return material
}

type Part = readonly [geometry: THREE.BufferGeometry, transform: THREE.Matrix4, color: THREE.Color]

function place(position: readonly [number, number, number], rotation: readonly [number, number, number] = [0, 0, 0], scale: readonly [number, number, number] = [1, 1, 1]): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  )
}

function merge(parts: readonly Part[]): THREE.BufferGeometry {
  const builder = new MeshBuilder()
  for (const [geometry, transform, color] of parts) {
    builder.append(geometry, transform, color)
    geometry.dispose()
  }
  return builder.build()
}

export function createGear(colors: GearColors, ghost: THREE.Material | null): Gear {
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh => {
    geometries.push(geometry)
    return new THREE.Mesh(geometry, material)
  }
  const own = <T extends THREE.Material>(material: T): T => {
    materials.push(material)
    return material
  }

  const shellParts: Part[] = [
    [new THREE.SphereGeometry(0.132, 28, 20), place([0, 0, -0.016], [0, 0, 0], [0.9, 1.0, 1.14]), colors.shell],
    [new THREE.BoxGeometry(0.024, 0.03, 0.24), place([0, 0.13, -0.03]), colors.trim],
    [new THREE.BoxGeometry(0.12, 0.04, 0.06), place([0, -0.105, 0.09]), colors.trim],
  ]
  const visorParts: Part[] = [
    [new THREE.SphereGeometry(0.136, 28, 12, -Math.PI * 0.36, Math.PI * 0.72, Math.PI * 0.38, Math.PI * 0.26), place([0, 0.004, -0.004], [0, Math.PI / 2, 0], [0.92, 1.0, 1.14]), new THREE.Color('#05060a')],
  ]
  const helmetLightParts: Part[] = [
    [new THREE.BoxGeometry(0.008, 0.008, 0.2), place([0, 0.147, -0.02]), colors.light],
    [new THREE.TorusGeometry(0.142, 0.004, 4, 32, Math.PI * 0.62), place([0, -0.035, 0], [Math.PI / 2, 0, Math.PI * 0.19], [0.95, 1.1, 1]), colors.light],
  ]

  const deckGeometry = new THREE.ExtrudeGeometry(roundedRect(0.52, 1.34, 0.24), { depth: 0.022, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.012, bevelSegments: 2, curveSegments: 10 })
  deckGeometry.rotateX(-Math.PI / 2)
  const edgeGeometry = new THREE.ExtrudeGeometry(roundedRect(0.55, 1.37, 0.255), { depth: 0.008, bevelEnabled: false, curveSegments: 10 })
  edgeGeometry.rotateX(-Math.PI / 2)
  const deckParts: Part[] = [
    [deckGeometry, place([0, -0.03, 0]), colors.deck],
    [new THREE.CylinderGeometry(0.1, 0.13, 0.05, 20), place([0, -0.08, -0.42]), colors.trim],
    [new THREE.CylinderGeometry(0.1, 0.13, 0.05, 20), place([0, -0.08, 0.42]), colors.trim],
  ]
  const boardLightParts: Part[] = [
    [edgeGeometry, place([0, -0.046, 0]), colors.light],
    [new THREE.BoxGeometry(0.03, 0.006, 0.98), place([0, 0.022, 0]), colors.light],
    [new THREE.CircleGeometry(0.095, 20), place([0, -0.106, -0.42], [Math.PI / 2, 0, 0]), colors.light],
    [new THREE.CircleGeometry(0.095, 20), place([0, -0.106, 0.42], [Math.PI / 2, 0, 0]), colors.light],
  ]

  const helmet = new THREE.Group()
  helmet.name = 'helmet'
  const board = new THREE.Group()
  board.name = 'hoverboard'
  const boardGlow = own(new THREE.MeshBasicMaterial({ color: colors.light.clone().multiplyScalar(0.35), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))

  if (ghost) {
    for (const part of [...helmetLightParts, ...boardLightParts]) part[0].dispose()
    helmet.add(mesh(merge([...shellParts, ...visorParts]), ghost))
    board.add(mesh(merge(deckParts), ghost))
  } else {
    const shellMaterial = own(rimmed(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.15 }), colors.rim, colors.fill))
    const visorMaterial = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.04, metalness: 1, emissive: new THREE.Color(0.02, 0.018, 0.012) }))
    const deckMaterial = own(rimmed(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.6 }), colors.rim.clone().multiplyScalar(0.5), colors.fill))
    const lightMaterial = own(new THREE.MeshBasicMaterial({ vertexColors: true }))
    helmet.add(mesh(merge(shellParts), shellMaterial), mesh(merge(visorParts), visorMaterial), mesh(merge(helmetLightParts), lightMaterial))
    const underLight = mesh(new THREE.PlaneGeometry(0.5, 1.2).rotateX(Math.PI / 2), boardGlow)
    underLight.position.y = -0.062
    board.add(mesh(merge(deckParts), deckMaterial), mesh(merge(boardLightParts), lightMaterial), underLight)
  }

  return {
    helmet,
    board,
    boardGlow,
    dispose() {
      helmet.removeFromParent()
      board.removeFromParent()
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
    },
  }
}
