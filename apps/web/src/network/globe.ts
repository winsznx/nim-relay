import * as T from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/** Geographic anchors are country label points, never a runner's precise location. */
export interface GlobeStop { countryCode: string | null; lat?: number; lon?: number }
export interface GlobeBaton { id: string; name: string; mode: string; holderName: string | null; handoffCount: number; route: GlobeStop[] }
export interface GlobeOptions {
  batons: GlobeBaton[]
  selectedId?: string | null
  onSelect: (id: string) => void
  arrival?: { batonId: string; key: string } | null
  reducedMotion?: boolean
}
export interface GlobeHandle { update(options: GlobeOptions): void; dispose(): void }
interface Country { code: string; name: string; lat: number; lon: number; rings: number[][][] }
const RADIUS = 2.55
const GOLD = 0xf5a623
const CYAN = 0x72d9e8

function position(lat: number, lon: number, radius = RADIUS): T.Vector3 {
  const phi = lat * Math.PI / 180, theta = lon * Math.PI / 180
  return new T.Vector3(Math.cos(phi) * Math.sin(theta), Math.sin(phi), Math.cos(phi) * Math.cos(theta)).multiplyScalar(radius)
}
function disposeObject(object: T.Object3D): void {
  object.traverse(child => {
    if (child instanceof T.Mesh || child instanceof T.Line || child instanceof T.Points || child instanceof T.Sprite) {
      if ('geometry' in child) child.geometry.dispose()
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      for (const material of materials) { if ('map' in material && material.map instanceof T.Texture) material.map.dispose(); material.dispose() }
    }
  })
}
function arc(from: T.Vector3, to: T.Vector3): T.CatmullRomCurve3 {
  const angle = from.angleTo(to), axis = new T.Vector3().crossVectors(from, to)
  if (axis.lengthSq() < 0.0001) axis.crossVectors(from, new T.Vector3(0, 1, 0))
  if (axis.lengthSq() < 0.0001) axis.set(1, 0, 0)
  axis.normalize()
  return new T.CatmullRomCurve3(Array.from({ length: 49 }, (_, i) => {
    const t = i / 48
    return from.clone().normalize().applyAxisAngle(axis, angle * t).multiplyScalar(RADIUS + 0.04 + Math.sin(t * Math.PI) * Math.min(1, 0.15 + angle * 0.36))
  }))
}
function caption(text: string): T.Sprite {
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 112
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(7,15,30,.9)'; ctx.beginPath(); ctx.roundRect(2, 2, 636, 108, 32); ctx.fill()
  ctx.strokeStyle = 'rgba(245,166,35,.5)'; ctx.lineWidth = 2; ctx.stroke()
  ctx.fillStyle = '#fff1d2'; ctx.font = '600 31px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text.slice(0, 33), 320, 56)
  const sprite = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(canvas), depthTest: false, transparent: true }))
  sprite.scale.set(1.9, 0.33, 1); return sprite
}

export function mountGlobe(host: HTMLElement, initial: GlobeOptions): GlobeHandle {
  let options = initial, alive = true, frame = 0, countries: Country[] = [], lastArrival = '', arrivalStart = 0
  const scene = new T.Scene(); scene.background = new T.Color(0x070e1d)
  const camera = new T.PerspectiveCamera(42, 1, 0.1, 100)
  camera.position.set(0.2, 1.6, 9.8)
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75)); renderer.outputColorSpace = T.SRGBColorSpace
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none'
  renderer.domElement.setAttribute('aria-label', 'Interactive Earth. Drag to rotate, scroll to zoom. Select a baton from the journey list for keyboard access.')
  host.appendChild(renderer.domElement)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true; controls.dampingFactor = 0.065; controls.enablePan = false; controls.minDistance = 6.6; controls.maxDistance = 13
  controls.rotateSpeed = 0.45; controls.maxPolarAngle = Math.PI * 0.82; controls.minPolarAngle = Math.PI * 0.18
  const world = new T.Group(); scene.add(world)
  const surface = new T.MeshStandardMaterial({ color: 0x101e32, roughness: 0.86, metalness: 0.15 })
  const earth = new T.Mesh(new T.SphereGeometry(RADIUS, 80, 48), surface); world.add(earth)
  // A soft Fresnel rim is atmosphere, not a halo suggesting unobserved activity.
  const atmosphere = new T.Mesh(new T.SphereGeometry(RADIUS * 1.035, 64, 40), new T.ShaderMaterial({
    transparent: true, depthWrite: false, side: T.BackSide, blending: T.AdditiveBlending,
    vertexShader: 'varying vec3 vNormal;varying vec3 vView;void main(){vec4 p=modelViewMatrix*vec4(position,1.0);vNormal=normalize(normalMatrix*normal);vView=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',
    fragmentShader: 'varying vec3 vNormal;varying vec3 vView;void main(){float rim=pow(1.0-abs(dot(vNormal,vView)),3.0);gl_FragColor=vec4(0.19,0.42,0.64,rim*0.45);}',
  })); world.add(atmosphere)
  scene.add(new T.AmbientLight(0x9aacc7, 1.8))
  const sun = new T.DirectionalLight(0xffd6a0, 3.6); sun.position.set(-5, 6, 8); scene.add(sun)
  const blue = new T.DirectionalLight(0x648fc1, 1.6); blue.position.set(7, -1, -3); scene.add(blue)
  const starPositions = new Float32Array(400 * 3)
  for (let i = 0; i < 400; i++) { const theta = i * 2.399963, y = 1 - 2 * (i + 0.5) / 400, radial = Math.sqrt(1 - y * y); starPositions.set([Math.cos(theta) * radial * 30, y * 30, Math.sin(theta) * radial * 30], i * 3) }
  const starGeometry = new T.BufferGeometry(); starGeometry.setAttribute('position', new T.BufferAttribute(starPositions, 3))
  scene.add(new T.Points(starGeometry, new T.PointsMaterial({ color: 0x9caec8, size: 0.045, transparent: true, opacity: 0.48, depthWrite: false })))
  const grid = new T.Group(); world.add(grid)
  const gridMaterial = new T.LineBasicMaterial({ color: 0x44607a, transparent: true, opacity: 0.17 })
  for (let lat = -60; lat <= 60; lat += 30) grid.add(new T.Line(new T.BufferGeometry().setFromPoints(Array.from({ length: 145 }, (_, i) => position(lat, i * 2.5, RADIUS + 0.006))), gridMaterial))
  for (let lon = 0; lon < 360; lon += 30) grid.add(new T.Line(new T.BufferGeometry().setFromPoints(Array.from({ length: 73 }, (_, i) => position(i * 2.5 - 90, lon, RADIUS + 0.006))), gridMaterial))
  const journeys = new T.Group(); world.add(journeys)
  const unknown = new T.Group(); scene.add(unknown)
  let targets: T.Object3D[] = [], traveler: T.Mesh | null = null, travelCurve: T.CatmullRomCurve3 | null = null
  let targetCamera: T.Vector3 | null = null
  function locate(stop: GlobeStop | undefined): T.Vector3 | null {
    if (!stop?.countryCode) return null
    const country = countries.find(item => item.code === stop.countryCode)
    // Only country anchors are rendered. Optional coordinates must not turn this into precise tracking.
    return country ? position(country.lat, country.lon, RADIUS + 0.035) : null
  }
  function rebuild(focus: boolean) {
    disposeObject(journeys); journeys.clear(); disposeObject(unknown); unknown.clear(); targets = []; traveler = null; travelCurve = null
    const unlocated = options.batons.filter(b => !locate(b.route.at(-1)))
    for (const baton of options.batons) {
      const selected = baton.id === options.selectedId, color = baton.mode === 'rival' ? CYAN : GOLD
      const current = locate(baton.route.at(-1))
      for (let i = 1; i < baton.route.length; i++) {
        const from = locate(baton.route[i - 1]), to = locate(baton.route[i])
        if (!from || !to) continue
        const curve = arc(from, to)
        const line = new T.Mesh(new T.TubeGeometry(curve, 64, selected ? 0.013 : 0.007, 5, false), new T.MeshBasicMaterial({ color, transparent: true, opacity: selected ? 0.92 : 0.38 }))
        line.userData.batonId = baton.id; journeys.add(line); targets.push(line)
        if (i === baton.route.length - 1 && options.arrival?.batonId === baton.id) travelCurve = curve
      }
      const marker = new T.Group(); marker.userData.batonId = baton.id
      const hex = new T.Mesh(new T.CylinderGeometry(0.11, 0.11, 0.18, 6), new T.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.24, emissive: color, emissiveIntensity: 0.6 }))
      hex.rotation.x = Math.PI / 2; marker.add(hex)
      for (let milestone = 0; milestone < Math.min(5, Math.floor(baton.handoffCount / 5)); milestone++) {
        const band = new T.Mesh(new T.TorusGeometry(0.13 + milestone * 0.025, 0.006, 4, 24), new T.MeshBasicMaterial({ color }))
        band.position.z = -0.025 * milestone; marker.add(band)
      }
      const ring = new T.Mesh(new T.TorusGeometry(selected ? 0.21 : 0.16, 0.014, 6, 32), new T.MeshBasicMaterial({ color, transparent: true, opacity: selected ? 0.9 : 0.5 })); marker.add(ring)
      if (current) { marker.position.copy(current); marker.lookAt(current.clone().multiplyScalar(2)); journeys.add(marker) }
      else { const index = unlocated.findIndex(item => item.id === baton.id); marker.position.set((index - (unlocated.length - 1) / 2) * 0.52, -3.1, 0.9); unknown.add(marker) }
      if (selected) { const name = caption(baton.holderName ? `${baton.name} · ${baton.holderName}` : baton.name); name.position.y = 0.44; marker.add(name) }
      marker.traverse(child => { child.userData.batonId = baton.id; if (child instanceof T.Mesh) targets.push(child) })
      if (selected && current && focus) targetCamera = current.clone().normalize().multiplyScalar(camera.position.length())
    }
    if (unlocated.length) { const label = caption('Location not shared'); label.position.set(0, -3.55, 0.9); unknown.add(label) }
    if (options.arrival && options.arrival.key !== lastArrival) {
      lastArrival = options.arrival.key; arrivalStart = performance.now()
      traveler = new T.Mesh(new T.IcosahedronGeometry(0.13, 1), new T.MeshBasicMaterial({ color: 0xffebaa })); journeys.add(traveler)
      if (!travelCurve) { traveler.visible = false } // A real transfer without locations must not invent a geographic flight.
    }
  }
  void fetch('/assets/earth-countries.json').then(response => { if (!response.ok) throw new Error('Earth asset unavailable'); return response.json() as Promise<Country[]> }).then(data => {
    if (!alive) return
    countries = data
    const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 1024
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#101c2b'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#334356'; ctx.strokeStyle = '#728093'; ctx.lineWidth = 0.7
    for (const country of countries) for (const ring of country.rings) {
      ctx.beginPath(); ring.forEach((pair, i) => { const x = (pair[0]! + 180) / 360 * canvas.width, y = (90 - pair[1]!) / 180 * canvas.height; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y) }); ctx.closePath(); ctx.fill(); ctx.stroke()
    }
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); surface.map = texture; surface.color.setHex(0xffffff); surface.needsUpdate = true; host.dataset.mapReady = 'true'
    // Three.js sphere UV starts at +X; align its country texture with our latitude/longitude anchors.
    earth.rotation.y = -Math.PI / 2
    rebuild(true)
  }).catch(error => { if (alive) { host.dataset.mapError = 'Earth geography could not load'; console.error('Earth geography could not load', error) } })
  const resize = () => { const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight); renderer.setSize(width, height, false); camera.aspect = width / height; camera.fov = width < 600 ? 52 : 42; camera.updateProjectionMatrix() }
  const observer = new ResizeObserver(resize); observer.observe(host); resize()
  const ray = new T.Raycaster(), pointer = new T.Vector2(); let downX = 0, downY = 0
  const down = (event: PointerEvent) => { downX = event.clientX; downY = event.clientY; targetCamera = null }
  const up = (event: PointerEvent) => { if (Math.hypot(event.clientX - downX, event.clientY - downY) > 7) return; const rect = renderer.domElement.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); ray.setFromCamera(pointer, camera); const hits = ray.intersectObjects(targets, false); const earthHit = ray.intersectObject(earth)[0]; const hit = hits.find(item => !earthHit || item.distance < earthHit.distance + 0.12); if (hit && typeof hit.object.userData.batonId === 'string') options.onSelect(hit.object.userData.batonId) }
  renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointerup', up)
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  let last = performance.now(), slowFrames = 0, measuredFrames = 0
  function animate(now: number) {
    if (!alive) return
    if (targetCamera) { camera.position.lerp(targetCamera, options.reducedMotion || reduced.matches ? 1 : 0.035); if (camera.position.distanceTo(targetCamera) < 0.02) targetCamera = null }
    controls.update()
    if (traveler && travelCurve) { const t = options.reducedMotion || reduced.matches ? 1 : Math.min(1, (now - arrivalStart) / 3600); traveler.position.copy(travelCurve.getPoint(t)); traveler.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.6) }
    renderer.render(scene, camera)
    if (now - last > 30) slowFrames++; measuredFrames++; last = now
    if (measuredFrames === 180) { if (slowFrames > 50) renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() - 0.25)); slowFrames = 0; measuredFrames = 0 }
    frame = requestAnimationFrame(animate)
  }
  rebuild(false); frame = requestAnimationFrame(animate)
  return {
    update(next) { const focus = next.selectedId !== options.selectedId; options = next; rebuild(focus) },
    dispose() { alive = false; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointerup', up); disposeObject(scene); renderer.dispose(); renderer.domElement.remove() },
  }
}
