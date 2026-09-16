import * as THREE from 'three'

/**
 * Floating labels for Relay Echoes. Every label is one row of a canvas atlas, drawn as a dark pill with a gold rim,
 * and every label shares one camera-facing instanced quad that slides back inside the frame near the screen edges.
 * Instance colour carries each label's data: r is its fade, g its shimmer and b its atlas row.
 */

/** Width of a label quad per unit of height, matching one atlas row. */
export const LABEL_ASPECT = 8

const ROW_WIDTH = 1024
const ROW_HEIGHT = ROW_WIDTH / LABEL_ASPECT
const PILL_INSET = 14
const TEXT_PADDING = 46
const FONT_SIZE = 58
const FONT_FAMILY = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif'

/** Share of the half screen width a label may reach from the centre. */
const SCREEN_EDGE = 0.94

const vertexShader = /* glsl */ `
  uniform float uRows;
  varying vec2 vUv;
  varying float vFade;
  varying float vShimmer;
  void main() {
    vFade = instanceColor.r;
    vShimmer = instanceColor.g;
    vUv = vec2(uv.x, (uv.y + uRows - 1.0 - instanceColor.b) / uRows);
    float size = length(instanceMatrix[0].xyz);
    vec4 centre = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
    float reach = max(0.0, ${SCREEN_EDGE.toFixed(2)} * -centre.z / projectionMatrix[0][0] - size * ${(LABEL_ASPECT / 2).toFixed(1)});
    centre.x = clamp(centre.x, -reach, reach);
    centre.xy += position.xy * size;
    gl_Position = projectionMatrix * centre;
  }
`

const fragmentShader = /* glsl */ `
  uniform sampler2D uAtlas;
  varying vec2 vUv;
  varying float vFade;
  varying float vShimmer;
  void main() {
    vec4 texel = texture2D(uAtlas, vUv);
    gl_FragColor = vec4(texel.rgb * (1.0 + vShimmer * 1.4), texel.a * vFade);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function drawLabel(context: CanvasRenderingContext2D, label: string, top: number): void {
  context.font = `800 ${FONT_SIZE}px ${FONT_FAMILY}`
  const room = ROW_WIDTH - 2 * (PILL_INSET + TEXT_PADDING)
  const fontSize = Math.min(FONT_SIZE, Math.floor((FONT_SIZE * room) / Math.max(1, context.measureText(label).width)))
  context.font = `800 ${fontSize}px ${FONT_FAMILY}`
  const width = Math.min(ROW_WIDTH - 2 * PILL_INSET, context.measureText(label).width + 2 * TEXT_PADDING)
  const height = ROW_HEIGHT - 2 * PILL_INSET
  context.beginPath()
  context.roundRect((ROW_WIDTH - width) / 2, top + PILL_INSET, width, height, height / 2)
  context.fillStyle = 'rgba(20, 13, 4, 0.76)'
  context.fill()
  context.strokeStyle = 'rgba(245, 166, 35, 0.9)'
  context.lineWidth = 4
  context.stroke()
  context.fillStyle = '#ffe2a8'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(label, ROW_WIDTH / 2, top + ROW_HEIGHT / 2 + 2)
}

/** One atlas row per label, top to bottom in the order given. */
export function createLabelAtlas(labels: readonly string[]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = ROW_WIDTH
  canvas.height = ROW_HEIGHT * Math.max(1, labels.length)
  const context = canvas.getContext('2d')
  if (context) labels.forEach((label, row) => drawLabel(context, label, row * ROW_HEIGHT))
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function createLabelMaterial(atlas: THREE.Texture, rows: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uAtlas: { value: atlas }, uRows: { value: Math.max(1, rows) } },
    transparent: true,
    depthWrite: false,
  })
}
