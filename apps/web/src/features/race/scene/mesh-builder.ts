import * as THREE from 'three'

/** Newell's method: a stable polygon normal even when two corners coincide. */
function newellNormal(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const corners = [a, b, c, d]
  out.set(0, 0, 0)
  for (let i = 0; i < 4; i++) {
    const current = corners[i]!
    const next = corners[(i + 1) % 4]!
    out.x += (current.y - next.y) * (current.z + next.z)
    out.y += (current.z - next.z) * (current.x + next.x)
    out.z += (current.x - next.x) * (current.y + next.y)
  }
  const length = out.length()
  return length > 1e-9 ? out.multiplyScalar(1 / length) : out.set(0, 1, 0)
}

/**
 * Accumulates non-indexed triangles with normals, uvs and linear vertex colours
 * into growable typed arrays, then emits one BufferGeometry. Static track and
 * world geometry is merged this way so a whole chunk draws in a few calls.
 */
export class MeshBuilder {
  private positions: Float32Array = new Float32Array(3 * 1024)
  private normals: Float32Array = new Float32Array(3 * 1024)
  private uvs: Float32Array = new Float32Array(2 * 1024)
  private colors: Float32Array = new Float32Array(3 * 1024)
  private count = 0

  private readonly e1 = new THREE.Vector3()
  private readonly e2 = new THREE.Vector3()
  private readonly n = new THREE.Vector3()

  get vertexCount(): number {
    return this.count
  }

  private reserve(extra: number): void {
    const needed = this.count + extra
    if (needed * 3 <= this.positions.length) return
    const size = Math.max(needed, Math.ceil((this.positions.length / 3) * 1.6))
    const grow = (source: Float32Array, stride: number): Float32Array => {
      const next = new Float32Array(size * stride)
      next.set(source.subarray(0, this.count * stride))
      return next
    }
    this.positions = grow(this.positions, 3)
    this.normals = grow(this.normals, 3)
    this.uvs = grow(this.uvs, 2)
    this.colors = grow(this.colors, 3)
  }

  private vertex(p: THREE.Vector3, normal: THREE.Vector3, u: number, v: number, color: THREE.Color): void {
    const i = this.count
    this.positions[i * 3] = p.x
    this.positions[i * 3 + 1] = p.y
    this.positions[i * 3 + 2] = p.z
    this.normals[i * 3] = normal.x
    this.normals[i * 3 + 1] = normal.y
    this.normals[i * 3 + 2] = normal.z
    this.uvs[i * 2] = u
    this.uvs[i * 2 + 1] = v
    this.colors[i * 3] = color.r
    this.colors[i * 3 + 1] = color.g
    this.colors[i * 3 + 2] = color.b
    this.count++
  }

  /**
   * Quad a-b-c-d in counter-clockwise order seen from the front face.
   * UVs map a=(u0,v0), b=(u1,v0), c=(u1,v1), d=(u0,v1).
   */
  quad(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    color: THREE.Color,
    uv: readonly [number, number, number, number] = [0, 0, 0, 0],
    colorFar: THREE.Color = color,
  ): void {
    this.reserve(6)
    newellNormal(a, b, c, d, this.n)
    const [u0, v0, u1, v1] = uv
    this.vertex(a, this.n, u0, v0, color)
    this.vertex(b, this.n, u1, v0, color)
    this.vertex(c, this.n, u1, v1, colorFar)
    this.vertex(a, this.n, u0, v0, color)
    this.vertex(c, this.n, u1, v1, colorFar)
    this.vertex(d, this.n, u0, v1, colorFar)
  }

  triangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color): void {
    this.reserve(3)
    this.n.crossVectors(this.e1.subVectors(b, a), this.e2.subVectors(c, a)).normalize()
    this.vertex(a, this.n, 0, 0, color)
    this.vertex(b, this.n, 0, 0, color)
    this.vertex(c, this.n, 0, 0, color)
  }

  /** Appends another geometry transformed by `matrix`, tinted with `color`. */
  append(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.Color): void {
    const source = geometry.index ? geometry.toNonIndexed() : geometry
    const position = source.getAttribute('position')
    const normal = source.getAttribute('normal')
    const uv = source.getAttribute('uv')
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix)
    const p = new THREE.Vector3()
    const nrm = new THREE.Vector3()
    this.reserve(position.count)
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(matrix)
      if (normal) nrm.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize()
      else nrm.set(0, 1, 0)
      this.vertex(p, nrm, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0, color)
    }
    if (source !== geometry) source.dispose()
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions.slice(0, this.count * 3), 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals.slice(0, this.count * 3), 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs.slice(0, this.count * 2), 2))
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors.slice(0, this.count * 3), 3))
    geometry.computeBoundingSphere()
    geometry.computeBoundingBox()
    return geometry
  }

  clear(): void {
    this.count = 0
  }
}
