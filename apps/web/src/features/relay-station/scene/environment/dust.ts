import * as THREE from 'three'
import type { StationKit } from '../kit'
import { PLACEMENT } from '../layout'
import { COLOR } from '../palette'
import { createRandom } from '../random'
import { OUTPUT } from '../shaders'

export interface Dust {
  readonly object: THREE.Points
  setLive(live: boolean): void
  /** Sheds particles when frames run long. */
  setBudget(fraction: number): void
}

/** Shafts as x, z, radius, height. The last shaft rises from the live portal. */
const SHAFTS: readonly [number, number, number, number][] = [
  [PLACEMENT.courier.position.x, PLACEMENT.courier.position.z, 1.25, 4.4],
  [PLACEMENT.vault.position.x - 0.2, PLACEMENT.vault.position.z + 0.5, 1.7, 3.2],
  [PLACEMENT.departures.position.x + 0.4, PLACEMENT.departures.position.z + 1.1, 2, 4.2],
  [PLACEMENT.live.position.x - 0.3, PLACEMENT.live.position.z + 0.8, 1.2, 4.2],
]
const SHAFT_BASES = [PLACEMENT.courier.position.y, PLACEMENT.vault.position.y, PLACEMENT.departures.position.y, PLACEMENT.live.position.y]
const LIVE_SHAFT = SHAFTS.length - 1

/** Motes drifting through the light shafts, animated entirely on the GPU. */
export function createDust(kit: StationKit): Dust {
  const count = kit.settings.dust
  const seeds = new Float32Array(count * 3)
  const extra = new Float32Array(count * 2)
  const random = createRandom(99)
  for (let i = 0; i < count; i++) {
    seeds.set([random(), random(), random()], i * 3)
    extra.set([i % SHAFTS.length, random()], i * 2)
  }
  const geometry = kit.track(new THREE.BufferGeometry())
  geometry.setAttribute('position', new THREE.BufferAttribute(seeds, 3))
  geometry.setAttribute('aExtra', new THREE.BufferAttribute(extra, 2))

  const shafts = SHAFTS.map(([x, z, radius, height]) => new THREE.Vector4(x, z, radius, height))
  const uniforms = {
    uTime: kit.uniforms.uTime,
    uPixelRatio: kit.uniforms.uPixelRatio,
    uShafts: { value: shafts },
    uShaftBases: { value: SHAFT_BASES },
    uGold: { value: COLOR.lamp },
    uCyan: { value: COLOR.cyan },
    uLive: { value: 0 },
  }
  const material = kit.track(
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        attribute vec2 aExtra;
        uniform float uTime;
        uniform float uPixelRatio;
        uniform vec4 uShafts[${SHAFTS.length}];
        uniform float uShaftBases[${SHAFTS.length}];
        uniform float uLive;
        varying float vAlpha;
        varying float vPortal;
        void main() {
          int index = int(aExtra.x + 0.5);
          vec4 shaft = uShafts[index];
          float portal = index == ${LIVE_SHAFT} ? 1.0 : 0.0;
          float speed = mix(0.012, 0.03, aExtra.y) * (1.0 + portal * 2.0);
          float rise = fract(position.z + uTime * speed * (portal > 0.5 ? 1.0 : -1.0));
          float angle = position.x * 6.2832 + uTime * 0.08 * (aExtra.y - 0.5);
          float radius = sqrt(position.y) * shaft.z;
          vec3 world = vec3(shaft.x + cos(angle) * radius, uShaftBases[index] + 0.15 + rise * shaft.w, shaft.y + sin(angle) * radius);
          world.x += sin(uTime * 0.37 + position.z * 30.0) * 0.06;
          vec4 viewPosition = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * viewPosition;
          gl_PointSize = min(3.5, (1.0 + aExtra.y * 2.2) * (14.0 / max(1.0, -viewPosition.z))) * uPixelRatio;
          float fade = smoothstep(0.0, 0.18, rise) * (1.0 - smoothstep(0.72, 1.0, rise));
          vAlpha = fade * (0.35 + 0.65 * aExtra.y) * mix(1.0, uLive, portal);
          vPortal = portal;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uGold;
        uniform vec3 uCyan;
        varying float vAlpha;
        varying float vPortal;
        void main() {
          float soft = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));
          vec3 color = mix(uGold, uCyan, vPortal) * 1.6;
          gl_FragColor = vec4(color, vAlpha * soft);
          ${OUTPUT}
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  const object = new THREE.Points(geometry, material)
  object.frustumCulled = false
  object.renderOrder = 3
  return {
    object,
    setLive(live) {
      uniforms.uLive.value = live ? 1 : 0
    },
    setBudget(fraction) {
      geometry.setDrawRange(0, Math.max(0, Math.floor(count * fraction)))
    },
  }
}
