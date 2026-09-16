import * as THREE from 'three'

/** Uniform objects shared by reference, so one write per frame reaches every material. */
export interface SharedUniforms {
  uTime: THREE.IUniform<number>
  uPixelRatio: THREE.IUniform<number>
  uFogColor: THREE.IUniform<THREE.Color>
  uFogDensity: THREE.IUniform<number>
}

export const FOG_PARS = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  vec3 applyFog(vec3 color, float depth) {
    float amount = 1.0 - exp(-uFogDensity * uFogDensity * depth * depth);
    return mix(color, uFogColor, clamp(amount, 0.0, 1.0));
  }
`

export const HASH = /* glsl */ `
  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }
  float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
`

export const OUTPUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`

/** Surface tags for the merged light lines; index 0 is the platform itself. */
export const LIGHT_TAGS = 8

/**
 * Architectural light lines. Each vertex carries a surface tag; writing `glow[tag]`
 * lets a focused surface burn brighter without a second material.
 */
export function createLightLineMaterial(shared: SharedUniforms, glow: Float32Array): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(1.0, 0.6, 0.2) },
      uGlow: { value: glow },
      uFogColor: shared.uFogColor,
      uFogDensity: shared.uFogDensity,
    },
    vertexShader: /* glsl */ `
      attribute float aTag;
      uniform float uGlow[${LIGHT_TAGS}];
      varying float vGlow;
      varying float vDepth;
      void main() {
        vGlow = uGlow[int(aTag + 0.5)];
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vDepth = -viewPosition.z;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vGlow;
      varying float vDepth;
      ${FOG_PARS}
      void main() {
        vec3 color = uColor * (1.35 + vGlow * 2.4);
        gl_FragColor = vec4(applyFog(color, vDepth), 1.0);
        ${OUTPUT}
      }
    `,
  })
}

export interface GlowOptions {
  color: THREE.Color
  strength: number
  /** How quickly light fades away from the source end (uv.y = 1). */
  falloff?: number
}

/** Soft additive volume for light shafts and beams. The bright end is uv.y = 1, the cone apex. */
export function createGlowMaterial(shared: SharedUniforms, options: GlowOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: options.color.clone() },
      uStrength: { value: options.strength },
      uFalloff: { value: options.falloff ?? 1.6 },
      uFogColor: shared.uFogColor,
      uFogDensity: shared.uFogDensity,
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vToCamera;
      varying float vDepth;
      void main() {
        vUv = uv;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vToCamera = normalize(-viewPosition.xyz);
        vDepth = -viewPosition.z;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      uniform float uFalloff;
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vToCamera;
      varying float vDepth;
      ${FOG_PARS}
      void main() {
        float along = pow(clamp(vUv.y, 0.0, 1.0), uFalloff);
        float facing = abs(dot(normalize(vNormalView), normalize(vToCamera)));
        float alpha = uStrength * along * pow(facing, 1.8);
        vec3 color = applyFog(uColor, vDepth);
        gl_FragColor = vec4(color, alpha);
        ${OUTPUT}
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
}

/** Dark glass that only shows itself where it turns away from the viewer. */
export function createGlassMaterial(shared: SharedUniforms, tint: THREE.Color, strength = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTint: { value: tint.clone() },
      uStrength: { value: strength },
      uFogColor: shared.uFogColor,
      uFogDensity: shared.uFogDensity,
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalView;
      varying vec3 vToCamera;
      varying float vDepth;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vToCamera = normalize(-viewPosition.xyz);
        vDepth = -viewPosition.z;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint;
      uniform float uStrength;
      varying vec3 vNormalView;
      varying vec3 vToCamera;
      varying float vDepth;
      ${FOG_PARS}
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormalView), normalize(vToCamera))), 2.4);
        vec3 color = applyFog(uTint, vDepth);
        gl_FragColor = vec4(color, uStrength * (0.05 + rim * 0.6));
        ${OUTPUT}
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
}

/** Radial falloff shared by halos, pools and contact shadows. */
export function createRadialTexture(): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.25, 'rgba(255,255,255,0.6)')
    gradient.addColorStop(0.6, 'rgba(255,255,255,0.14)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
