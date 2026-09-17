import * as THREE from 'three'

/**
 * Light points for world life: car lamps, navigation lights, drone strobes.
 * Every module writes its lights here each frame and the whole pool draws as
 * one instanced, camera-facing, additive mesh. Sizes stay readable at range: a
 * sprite never shrinks below a minimum share of the screen.
 */

const vertex = /* glsl */ `
  uniform float uMinPixels;
  uniform float uViewportHeight;
  varying vec2 vUv;
  varying vec3 vColor;
  void main() {
    vUv = uv;
    vColor = instanceColor;
    vec4 centre = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
    float size = length(instanceMatrix[0].xyz);
    float perPixel = -centre.z * 2.0 / (projectionMatrix[1][1] * uViewportHeight);
    centre.xy += position.xy * max(size, uMinPixels * perPixel);
    gl_Position = projectionMatrix * centre;
  }
`

const fragment = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float core = pow(max(0.0, 1.0 - r), 3.0);
    gl_FragColor = vec4(vColor * core, 1.0);
  }
`

export class SpritePool {
  readonly mesh: THREE.InstancedMesh
  private cursor = 0
  private readonly matrix = new THREE.Matrix4()
  private readonly material: THREE.ShaderMaterial

  constructor(private readonly capacity: number) {
    const geometry = new THREE.PlaneGeometry(1, 1)
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uMinPixels: { value: 2.2 }, uViewportHeight: { value: 800 } },
    })
    this.mesh = new THREE.InstancedMesh(geometry, this.material, capacity)
    this.mesh.name = 'density-sprites'
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.mesh.setColorAt(0, new THREE.Color(0, 0, 0))
  }

  begin(viewportHeight: number): void {
    this.cursor = 0
    this.material.uniforms.uViewportHeight!.value = viewportHeight
  }

  add(x: number, y: number, z: number, size: number, color: THREE.Color): void {
    if (this.cursor >= this.capacity) return
    this.matrix.makeScale(size, size, size).setPosition(x, y, z)
    this.mesh.setMatrixAt(this.cursor, this.matrix)
    this.mesh.setColorAt(this.cursor, color)
    this.cursor++
  }

  end(): void {
    this.mesh.count = this.cursor
    this.mesh.visible = this.cursor > 0
    if (this.cursor === 0) return
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.mesh.dispose()
  }
}
