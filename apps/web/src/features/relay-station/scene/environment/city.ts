import * as THREE from 'three'
import type { StationKit } from '../kit'
import { COLOR } from '../palette'
import { createRandom } from '../random'
import { FOG_PARS, HASH, OUTPUT } from '../shaders'

/** Street level, far below the elevated deck. */
export const GROUND_Y = -130

const FRONT_ARC = 1.95

/** Towers whose windows are shaded procedurally from instance data, in one draw. */
export function createCity(kit: StationKit): THREE.Group {
  const group = new THREE.Group()
  group.name = 'city'
  group.add(createTowers(kit))
  group.add(createStreetLights(kit))
  return group
}

function createTowers(kit: StationKit): THREE.InstancedMesh {
  const count = kit.settings.towers
  const random = createRandom(20260916)
  const geometry = kit.track(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0))
  const seeds = new Float32Array(count)
  const lit = new Float32Array(count)
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1))
  geometry.setAttribute('aLit', new THREE.InstancedBufferAttribute(lit, 1))

  const material = kit.track(
    new THREE.ShaderMaterial({
      uniforms: {
        uFacade: { value: new THREE.Color('#0b1020') },
        uWarm: { value: COLOR.windowWarm },
        uCool: { value: COLOR.windowCool },
        uCrown: { value: COLOR.gold },
        uFogColor: kit.uniforms.uFogColor,
        uFogDensity: kit.uniforms.uFogDensity,
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        attribute float aLit;
        varying vec3 vLocal;
        varying vec3 vNormalLocal;
        varying vec3 vScale;
        varying float vSeed;
        varying float vLit;
        varying float vDepth;
        void main() {
          vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vLocal = position;
          vNormalLocal = normal;
          vSeed = aSeed;
          vLit = aLit;
          vec4 viewPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
          vDepth = -viewPosition.z;
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uFacade;
        uniform vec3 uWarm;
        uniform vec3 uCool;
        uniform vec3 uCrown;
        varying vec3 vLocal;
        varying vec3 vNormalLocal;
        varying vec3 vScale;
        varying float vSeed;
        varying float vLit;
        varying float vDepth;
        ${FOG_PARS}
        ${HASH}
        void main() {
          float height = vLocal.y * vScale.y;
          vec3 facade = uFacade * (0.45 + 0.55 * clamp(vLocal.y * 1.4, 0.0, 1.0));
          if (vNormalLocal.y > 0.5) {
            gl_FragColor = vec4(applyFog(facade * 0.7, vDepth), 1.0);
            ${OUTPUT}
            return;
          }
          float across = abs(vNormalLocal.x) > 0.5 ? vLocal.z * vScale.z : vLocal.x * vScale.x;
          float bay = 1.2 + hash11(vSeed * 91.7) * 0.8;
          vec2 grid = vec2(across / bay, height / 3.1);
          vec2 cell = floor(grid);
          vec2 inside = fract(grid);
          float pane = step(0.2, inside.x) * step(inside.x, 0.8) * step(0.22, inside.y) * step(inside.y, 0.74);
          float on = step(1.0 - vLit, hash21(cell + vec2(vSeed * 173.0, vNormalLocal.x * 7.0 + vNormalLocal.z * 13.0)));
          vec3 lamp = mix(uWarm, uCool, step(0.82, hash21(cell * 1.7 + vSeed * 31.0)));
          float level = 0.2 + 0.8 * hash21(cell + 4.1);
          vec3 windows = lamp * pane * on * level * 0.75;
          float far = smoothstep(240.0, 620.0, vDepth);
          vec3 color = facade + mix(windows, lamp * vLit * 0.32 * (0.6 + 0.4 * step(0.5, fract(height / 7.0 + vSeed))), far);
          float crowned = step(0.62, fract(vSeed * 7.13));
          color += uCrown * crowned * smoothstep(0.7, 0.0, abs(height - vScale.y + 1.4)) * 0.55;
          gl_FragColor = vec4(applyFog(color, vDepth), 1.0);
          ${OUTPUT}
        }
      `,
    }),
  )

  const towers = kit.track(new THREE.InstancedMesh(geometry, material, count))
  const matrix = new THREE.Matrix4()
  const rotation = new THREE.Quaternion()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  for (let i = 0; i < count; i++) {
    const angle = (random() * 2 - 1) * FRONT_ARC
    const distance = 230 + random() ** 1.05 * 700
    const x = Math.sin(angle) * distance
    const z = -Math.cos(angle) * distance
    const rise = random() ** 2.6
    const reach = THREE.MathUtils.smoothstep(distance, 300, 850)
    const landmark = distance > 600 && random() > 0.95 ? 24 : 0
    const valley = 0.25 + 0.75 * THREE.MathUtils.smoothstep(Math.abs(angle), 0.12, 0.6)
    const top = -52 + (rise * (30 + reach * 62) + landmark) * valley
    const width = 12 + random() * 20
    position.set(x, GROUND_Y, z)
    rotation.setFromAxisAngle(up, random() * Math.PI)
    scale.set(width, top - GROUND_Y, 9 + random() * 16)
    towers.setMatrixAt(i, matrix.compose(position, rotation, scale))
    seeds[i] = random()
    lit[i] = 0.05 + random() ** 1.6 * 0.24
  }
  towers.instanceMatrix.needsUpdate = true
  towers.computeBoundingSphere()
  return towers
}

function createStreetLights(kit: StationKit): THREE.Points {
  const count = kit.settings.cityLights
  const random = createRandom(4242)
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sodium = new THREE.Color('#ff9d42')
  const white = new THREE.Color('#fff1d6')
  for (let i = 0; i < count; i++) {
    const angle = (random() * 2 - 1) * (FRONT_ARC + 0.3)
    const distance = 150 + random() ** 0.9 * 650
    let x = Math.sin(angle) * distance
    let z = -Math.cos(angle) * distance
    if (random() < 0.75) {
      if (random() < 0.5) x = Math.round(x / 38) * 38
      else z = Math.round(z / 38) * 38
    }
    positions[i * 3] = x
    positions[i * 3 + 1] = GROUND_Y + 1
    positions[i * 3 + 2] = z
    const tint = random() < 0.8 ? sodium : white
    const level = 0.5 + random() * 0.8
    colors[i * 3] = tint.r * level
    colors[i * 3 + 1] = tint.g * level
    colors[i * 3 + 2] = tint.b * level
  }
  const geometry = kit.track(new THREE.BufferGeometry())
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const material = kit.track(
    new THREE.PointsMaterial({
      size: 2.6,
      map: kit.radial,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }),
  )
  return new THREE.Points(geometry, material)
}
