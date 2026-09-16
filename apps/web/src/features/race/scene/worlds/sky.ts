import * as THREE from 'three'
import type { SkyStyle } from './types'

/**
 * Gradient sky dome with sun or moon glow, stars, horizon haze and soft cloud
 * streaks. It follows the camera and never writes depth, so it costs one draw
 * call and never clips against the far plane.
 */

const vertex = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = clip.xyww;
  }
`

const fragment = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uMiddle;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  uniform vec3 uCloudColor;
  uniform float uMiddleHeight;
  uniform float uSunSize;
  uniform float uSunGlow;
  uniform float uSunSpread;
  uniform float uStars;
  uniform float uHaze;
  uniform float uClouds;
  uniform float uShimmer;
  uniform float uTime;
  uniform float uFinale;
  varying vec3 vDirection;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(vec3(i, 1.0));
    float b = hash(vec3(i + vec2(1.0, 0.0), 1.0));
    float c = hash(vec3(i + vec2(0.0, 1.0), 1.0));
    float d = hash(vec3(i + vec2(1.0, 1.0), 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    vec3 direction = normalize(vDirection);
    float wave = sin(direction.x * 140.0 + uTime * 5.0) * sin(direction.z * 97.0 - uTime * 3.7);
    float h = direction.y + uShimmer * 0.0035 * wave * exp(-abs(direction.y) * 40.0);
    vec3 color;
    if (h >= 0.0) {
      float lower = smoothstep(0.0, uMiddleHeight, h);
      float upper = smoothstep(uMiddleHeight, 0.85, h);
      color = mix(uHorizon, uMiddle, pow(lower, 0.55));
      color = mix(color, uTop, upper);
    } else {
      color = mix(uHorizon, uBottom, smoothstep(0.0, 0.18, -h));
    }

    vec3 sunDirection = normalize(uSunDirection);
    float sunDot = max(dot(direction, sunDirection), 0.0);
    color += uSunColor * (pow(sunDot, uSunSpread) * 0.28 + pow(sunDot, 64.0) * 0.55) * uSunGlow;
    if (uSunSize > 0.0) {
      float disc = smoothstep(cos(uSunSize), cos(uSunSize * 0.82), sunDot);
      color = mix(color, uSunColor * 2.2, disc);
    }

    float band = exp(-abs(h) * 16.0);
    color += uHorizon * band * uHaze * (1.0 + uShimmer * 0.12 * wave);

    if (uClouds > 0.0 && h > -0.02) {
      vec2 plane = direction.xz / (h + 0.18);
      float streak = noise(vec2(plane.x * 1.3 + uTime * 0.01, plane.y * 5.0));
      streak *= noise(vec2(plane.x * 3.1 - uTime * 0.013, plane.y * 11.0 + 3.0));
      float mask = smoothstep(0.18, 0.5, streak) * smoothstep(0.42, 0.03, h);
      vec3 lit = uCloudColor + uSunColor * (pow(sunDot, 14.0) * 0.5 + pow(sunDot, 4.0) * 0.06);
      color = mix(color, lit, mask * uClouds);
    }

    if (uStars > 0.0 && h > 0.04) {
      vec3 cell = floor(direction * 220.0);
      float star = step(0.9972, hash(cell));
      float twinkle = 0.55 + 0.45 * sin(uTime * 1.7 + hash(cell + 3.1) * 40.0);
      color += vec3(0.9, 0.95, 1.0) * star * twinkle * uStars * smoothstep(0.04, 0.35, h);
    }

    color += vec3(1.0, 0.78, 0.42) * uFinale * 0.35 * exp(-abs(h) * 6.0);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export interface Sky {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  update(camera: THREE.Camera, time: number, finale: number): void
  dispose(): void
}

export function createSky(style: SkyStyle): Sky {
  const geometry = new THREE.SphereGeometry(10, 32, 16)
  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uTop: { value: new THREE.Color(style.top) },
      uMiddle: { value: new THREE.Color(style.middle) },
      uHorizon: { value: new THREE.Color(style.horizon) },
      uBottom: { value: new THREE.Color(style.bottom) },
      uSunColor: { value: new THREE.Color(style.sunColor) },
      uSunDirection: { value: new THREE.Vector3(...style.sunDirection).normalize() },
      uCloudColor: { value: new THREE.Color(style.cloudColor) },
      uMiddleHeight: { value: style.middleHeight },
      uSunSize: { value: style.sunSize },
      uSunGlow: { value: style.sunGlow },
      uSunSpread: { value: style.sunSpread },
      uStars: { value: style.stars },
      uHaze: { value: style.haze },
      uClouds: { value: style.clouds },
      uShimmer: { value: style.shimmer },
      uTime: { value: 0 },
      uFinale: { value: 0 },
    },
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'sky'
  mesh.frustumCulled = false
  mesh.renderOrder = -1000
  return {
    mesh,
    material,
    update(camera, time, finale) {
      mesh.position.copy(camera.position)
      material.uniforms.uTime!.value = time
      material.uniforms.uFinale!.value = finale
    },
    dispose() {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
