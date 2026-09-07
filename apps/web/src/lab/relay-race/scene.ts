import * as THREE from 'three'
import { relayRace } from '@nim-relay/game-engine'
import type { RaceController } from './controller'

const ONE = 65536
const SEG = 9 // world units per sim distance-unit
const LANE_W = 6 // world half-width for x = ±ONE

const GOLD = 0xf6a723
const CYAN = 0x28d7ef
const RED = 0xff4d47
const GHOST_C = 0x7fd7ff

const z = (dist: number): number => -(dist / ONE) * SEG
const wx = (x: number): number => (x / ONE) * LANE_W

function courierMesh(color: number, ghost = false): THREE.Group {
  const g = new THREE.Group()
  const mat = (c: number, emissive = 0, rough = 0.7): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color: ghost ? GHOST_C : c, emissive: new THREE.Color(ghost ? GHOST_C : emissive), emissiveIntensity: ghost ? 0.5 : (emissive ? 1 : 0), roughness: rough, metalness: 0.1, transparent: ghost, opacity: ghost ? 0.3 : 1, depthWrite: !ghost })

  const board = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.12, 2.5), mat(ghost ? GHOST_C : 0x1a2436, ghost ? 0 : color, 0.4))
  board.position.y = 0.16
  const glow = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.05, 2.6), mat(color, color))
  glow.position.y = 0.06
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.78, 0.34), new THREE.MeshBasicMaterial({ color: ghost ? GHOST_C : 0xe86a1e, transparent: ghost, opacity: ghost ? 0.3 : 1 }))
  torso.position.y = 0.85
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), new THREE.MeshBasicMaterial({ color: ghost ? GHOST_C : 0xffe0c2, transparent: ghost, opacity: ghost ? 0.3 : 1 }))
  head.position.y = 1.42
  const baton = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.5, 8), mat(GOLD, GOLD))
  baton.rotation.z = Math.PI / 5
  baton.position.set(0.36, 1.15, 0.05)
  const batonGlow = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: ghost ? 0.15 : 0.35 }))
  batonGlow.position.copy(baton.position)
  g.add(board, glow, torso, head, baton, batonGlow)
  g.userData.baton = batonGlow
  return g
}

export function mountRaceScene(host: HTMLElement, controller: RaceController): () => void {
  const track = relayRace.buildTrack(controller.config.seed)
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const resize = (): void => renderer.setSize(host.clientWidth, host.clientHeight, true)
  host.appendChild(renderer.domElement)
  Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block' })

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b1330)
  scene.fog = new THREE.FogExp2(0x121a3a, 0.004)

  const cam = new THREE.PerspectiveCamera(64, 1, 0.1, 900)
  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x101828, 1.15))
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.5)
  sun.position.set(-24, 50, 26)
  scene.add(sun)

  // ── sky gradient dome ──
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(600, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { top: { value: new THREE.Color(0x16264f) }, bot: { value: new THREE.Color(0x3a2150) } },
      vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 p; uniform vec3 top; uniform vec3 bot; void main(){ vec3 n = normalize(p); float h = n.y*0.5+0.5; vec3 c = mix(bot, top, smoothstep(0.1,0.7,h)); c += vec3(0.35,0.22,0.12) * pow(max(0.0, 1.0 - abs(n.y)*3.0), 2.0); gl_FragColor = vec4(c, 1.0); }',
    }),
  )
  scene.add(dome)

  // ── track surface + rails ──
  const trackLen = (track.finishDist / ONE) * SEG + 60
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(LANE_W * 2.4, trackLen),
    new THREE.MeshStandardMaterial({ color: 0x141d30, roughness: 0.95, metalness: 0 }),
  )
  surface.rotation.x = -Math.PI / 2
  surface.position.set(0, 0, -trackLen / 2 + 30)
  scene.add(surface)
  const railGeo = new THREE.BoxGeometry(0.14, 0.14, trackLen)
  const railMat = new THREE.MeshBasicMaterial({ color: 0x2f6bce })
  for (const sx of [-1, 1]) {
    const r = new THREE.Mesh(railGeo, railMat)
    r.position.set(sx * LANE_W * 1.15, 0.2, -trackLen / 2 + 30)
    scene.add(r)
  }
  // shortcut branch strip
  const branch = new THREE.Mesh(
    new THREE.PlaneGeometry(LANE_W * 1.0, ((track.forkRejoin - track.forkDist) / ONE) * SEG),
    new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.1 }),
  )
  branch.rotation.x = -Math.PI / 2
  branch.position.set(track.shortcutSide * LANE_W * 0.7, 0.02, (z(track.forkDist) + z(track.forkRejoin)) / 2)
  scene.add(branch)

  // boost-zone strips
  for (const bz of track.boostZones) {
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(LANE_W * 1.6, ((bz.to - bz.from) / ONE) * SEG),
      new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.1 }),
    )
    strip.rotation.x = -Math.PI / 2
    strip.position.set(0, 0.03, (z(bz.from) + z(bz.to)) / 2)
    scene.add(strip)
  }

  // centre-line dashes
  const chevMat = new THREE.MeshBasicMaterial({ color: 0x4a6aa0, transparent: true, opacity: 0.35 })
  for (let d = 6; d < track.finishDist / ONE; d += 5) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 1.6), chevMat)
    c.position.set(0, 0.05, z(d * ONE))
    scene.add(c)
  }

  // ── gates (pool) ──
  const sortedGates = [...track.gates].sort((a, b) => a.dist - b.dist)
  const GATE_POOL = 16
  const gatePool = Array.from({ length: GATE_POOL }, () => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 8, 20), new THREE.MeshStandardMaterial({ color: GOLD, emissive: new THREE.Color(GOLD), emissiveIntensity: 1.4, roughness: 0.4 }))
    m.visible = false
    scene.add(m)
    return m
  })
  const sortedHaz = [...track.hazards].sort((a, b) => a.dist - b.dist)
  const HAZ_POOL = 8
  const hazPool = Array.from({ length: HAZ_POOL }, () => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(LANE_W * 0.9, 0.7, 0.5), new THREE.MeshStandardMaterial({ color: RED, emissive: new THREE.Color(RED), emissiveIntensity: 0.8, roughness: 0.5 }))
    m.visible = false
    scene.add(m)
    return m
  })

  // ── finish arch + waiting courier ──
  const arch = new THREE.Group()
  const pillarGeo = new THREE.BoxGeometry(0.5, 6, 0.5)
  const archMat = new THREE.MeshStandardMaterial({ color: GOLD, emissive: new THREE.Color(GOLD), emissiveIntensity: 1.1 })
  for (const sx of [-1, 1]) { const p = new THREE.Mesh(pillarGeo, archMat); p.position.set(sx * LANE_W * 1.1, 3, 0); arch.add(p) }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(LANE_W * 2.4, 0.5, 0.5), archMat)
  bar.position.y = 6
  arch.add(bar)
  arch.position.z = z(track.finishDist)
  scene.add(arch)
  const nextCourier = courierMesh(CYAN)
  nextCourier.position.set(0, 0, z(track.finishDist) - 8)
  nextCourier.rotation.y = Math.PI
  scene.add(nextCourier)

  // ── couriers ──
  const you = courierMesh(GOLD)
  const ghost = courierMesh(GHOST_C, true)
  you.scale.setScalar(1.08)
  ghost.scale.setScalar(1.08)
  scene.add(you, ghost)

  // trail + speed lines
  const trail = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 6), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
  trail.rotation.x = -Math.PI / 2
  you.add(trail)
  trail.position.set(0, 0.1, 3.4)
  const streaks = Array.from({ length: 8 }, () => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 5), new THREE.MeshBasicMaterial({ color: 0xdfeaff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    m.rotation.x = Math.PI / 2 // lie flat along travel
    scene.add(m)
    return m
  })

  let camX = 0
  let camFov = 62
  let raf = 0
  const clock = { last: performance.now() }

  const applyGate = (m: THREE.Mesh, g: (typeof sortedGates)[number], camZ: number): void => {
    m.visible = true
    m.position.set(wx(g.x), 1.15, z(g.dist))
    const beat = g.kind === 'beat'
    const mat = m.material as THREE.MeshStandardMaterial
    mat.color.set(beat ? CYAN : GOLD)
    mat.emissive.set(beat ? CYAN : GOLD)
    const s = beat ? 1 + Math.sin(clock.last / 120) * 0.12 : 1
    m.scale.setScalar((g.half / ONE) * LANE_W * 0.5 * s + 0.3)
    void camZ
  }

  const loop = (now: number): void => {
    const dt = Math.min(0.05, (now - clock.last) / 1000)
    clock.last = now
    controller.frame(now)
    const snap = controller.getRenderSnapshot()
    const st = snap.state
    const alpha = controller.interpolation

    const yD = st.dist
    const yX = wx(st.x)
    const yZ = z(yD)
    you.position.set(yX, 0.55, yZ)
    you.rotation.z = THREE.MathUtils.clamp(-(st.vx / ONE) * 7, -0.5, 0.5)
    you.rotation.x = snap.boosting ? -0.12 : 0
    const gh = snap.ghost
    ghost.position.set(wx(gh.x), 0.55, z(gh.dist))
    ghost.rotation.z = THREE.MathUtils.clamp(-(gh.vx / ONE) * 7, -0.5, 0.5)
    ghost.visible = snap.phase === 'racing' || snap.phase === 'countdown' || snap.phase === 'handoff'

    // camera chase — close behind, courier sits prominent in the lower third
    camX += (yX - camX) * Math.min(1, dt * 7)
    cam.position.set(camX * 0.5, 2.9, yZ + 9.4)
    cam.lookAt(camX * 0.3, 1.15, yZ - 14)
    const targetFov = snap.boosting ? 76 : snap.overheating ? 60 : 64
    camFov += (targetFov - camFov) * Math.min(1, dt * 4)
    cam.fov = camFov
    cam.updateProjectionMatrix()
    void alpha

    // gates
    let gi = sortedGates.findIndex((g) => g.dist > yD - 4 * ONE)
    if (gi < 0) gi = sortedGates.length
    for (let k = 0; k < GATE_POOL; k++) {
      const g = sortedGates[gi + k]
      if (!g || g.dist > yD + 60 * ONE) { gatePool[k]!.visible = false; continue }
      applyGate(gatePool[k]!, g, yZ)
    }
    let hj = sortedHaz.findIndex((h) => h.dist > yD - 4 * ONE)
    if (hj < 0) hj = sortedHaz.length
    for (let k = 0; k < HAZ_POOL; k++) {
      const h = sortedHaz[hj + k]
      if (!h || h.dist > yD + 60 * ONE) { hazPool[k]!.visible = false; continue }
      hazPool[k]!.visible = true
      hazPool[k]!.position.set(wx(h.x), 0.55, z(h.dist))
    }

    // boost feedback
    const tmat = trail.material as THREE.MeshBasicMaterial
    tmat.opacity += ((snap.boosting ? 0.5 : 0.08) - tmat.opacity) * Math.min(1, dt * 8)
    trail.scale.y = snap.boosting ? 2.4 : 1
    const bg = you.userData.baton as THREE.Mesh
    ;(bg.material as THREE.MeshBasicMaterial).opacity = 0.3 + (snap.overheating ? 0.4 * Math.abs(Math.sin(now / 60)) : snap.boosting ? 0.35 : 0.15)
    streaks.forEach((s, i) => {
      const sm = s.material as THREE.MeshBasicMaterial
      sm.opacity += ((snap.boosting ? 0.45 : 0) - sm.opacity) * Math.min(1, dt * 10)
      const off = ((now / 22 + i * 29) % 34)
      s.position.set(camX * 0.55 + (i - 3.5) * 1.4, 0.6 + (i % 3) * 0.7, yZ + 6 - off)
    })

    renderer.render(scene, cam)
    const info = renderer.info.render
    controller.measure(info.triangles, info.calls)
    raf = requestAnimationFrame(loop)
  }

  resize()
  window.addEventListener('resize', resize)
  raf = requestAnimationFrame(loop)

  return () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('resize', resize)
    renderer.dispose()
    renderer.domElement.remove()
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      o.geometry.dispose()
      const m = o.material as THREE.Material | THREE.Material[]
      if (Array.isArray(m)) m.forEach((x) => x.dispose())
      else m.dispose()
    })
  }
}
