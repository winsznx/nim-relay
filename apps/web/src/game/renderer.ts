import { Application, Graphics } from 'pixi.js'
import type { GameController, SimState } from './controller'

const GOLD = 0xf5a623
const CYAN = 0x22d3ee
const MUTED = 0x52617e
const TAU = Math.PI * 2
interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: number }

export async function mountRenderer(host: HTMLElement, controller: GameController): Promise<() => void> {
  const app = new Application()
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  await app.init({ resizeTo: host, backgroundAlpha: 0, antialias: true, resolution: dpr, autoDensity: true, preference: 'webgl', autoStart: false })
  host.appendChild(app.canvas)
  const field = new Graphics()
  const trail = new Graphics()
  const baton = new Graphics()
  app.stage.addChild(field, trail, baton)
  const particles: Particle[] = []
  const history: { x: number; y: number }[] = []
  let drawCalls = 0
  const gl = 'gl' in app.renderer ? app.renderer.gl as WebGLRenderingContext : null
  const originalArrays = gl?.drawArrays.bind(gl)
  const originalElements = gl?.drawElements.bind(gl)
  const gl2 = gl && 'drawArraysInstanced' in gl ? gl as WebGL2RenderingContext : null
  const originalArraysInstanced = gl2?.drawArraysInstanced.bind(gl2)
  const originalElementsInstanced = gl2?.drawElementsInstanced.bind(gl2)
  if (gl && originalArrays && originalElements) {
    gl.drawArrays = (...args: Parameters<WebGLRenderingContext['drawArrays']>) => { drawCalls++; originalArrays(...args) }
    gl.drawElements = (...args: Parameters<WebGLRenderingContext['drawElements']>) => { drawCalls++; originalElements(...args) }
  }
  if (gl2 && originalArraysInstanced && originalElementsInstanced) {
    gl2.drawArraysInstanced = (...args: Parameters<WebGL2RenderingContext['drawArraysInstanced']>) => { drawCalls++; originalArraysInstanced(...args) }
    gl2.drawElementsInstanced = (...args: Parameters<WebGL2RenderingContext['drawElementsInstanced']>) => { drawCalls++; originalElementsInstanced(...args) }
  }
  let animation = 0
  let oldTick = 0
  let oldCombo = 0
  let oldStrikes = 0
  let lastTime = 0
  let shake = 0
  let lastInput = 0
  let launch: { x: number; y: number; vx: number; vy: number; life: number } | null = null
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  function hex(x: number, y: number, radius: number, color: number, alpha: number) {
    const points = Array.from({ length: 6 }, (_, i) => ({ x: x + Math.cos(i * TAU / 6 - Math.PI / 6) * radius, y: y + Math.sin(i * TAU / 6 - Math.PI / 6) * radius }))
    baton.poly(points).fill({ color, alpha })
  }
  function location(state: SimState, cx: number, cy: number, radius: number, position: number) {
    if (state.config.challenge === 'stabilize') {
      const angle = -Math.PI * 0.75 + position * Math.PI * 1.5
      return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius }
    }
    if (state.config.challenge === 'sling') {
      const angle = -Math.PI + state.angle / 65536 * Math.PI
      const power = 28 + state.power / 65536 * radius * 0.8
      return { x: cx + Math.cos(angle) * power, y: cy + Math.sin(angle) * power + radius * 0.55 }
    }
    return { x: cx - radius * 0.82 + position * radius * 1.64, y: cy + (state.config.challenge === 'slipstream' ? radius * 0.65 : 0) }
  }
  function frame(now: number) {
    controller.frame(now)
    const snap = controller.getRenderSnapshot()
    const state = snap.state
    const dt = lastTime ? Math.min(40, now - lastTime) / 16.667 : 1
    lastTime = now
    if (state.tick < oldTick) { history.length = 0; particles.length = 0; oldCombo = 0; oldStrikes = 0; launch = null; lastInput = 0 }
    oldTick = state.tick
    const width = host.clientWidth, height = host.clientHeight
    const cx = width / 2, cy = height * 0.47, radius = Math.min(width * 0.38, height * 0.37, 205)
    field.clear(); trail.clear(); baton.clear()
    for (let i = 0; i < 55; i++) {
      const x = ((i * 137 + 29) % 997) / 997 * width
      const y = ((i * 193 + 73) % 991) / 991 * height
      field.circle(x, y, i % 5 === 0 ? 1.3 : 0.7).fill({ color: 0x90a1c2, alpha: 0.12 + (i % 4) * 0.035 })
    }
    const target = state.target / 65536
    const targetX = cx - radius * 0.82 + target * radius * 1.64
    const safe = state.safeWidth / 65536
    const perfect = state.perfectWidth / 65536
    if (state.config.challenge === 'stabilize') {
      field.circle(cx, cy, radius + 21).stroke({ color: MUTED, width: 1, alpha: 0.25 })
      field.beginPath().arc(cx, cy, radius, -Math.PI * 0.75, Math.PI * 0.75).stroke({ color: MUTED, width: 13, alpha: 0.2 })
      const angle = -Math.PI * 0.75 + target * Math.PI * 1.5
      field.beginPath().arc(cx, cy, radius, angle - safe * Math.PI * 1.5, angle + safe * Math.PI * 1.5).stroke({ color: CYAN, width: 17, alpha: 0.16 })
      field.beginPath().arc(cx, cy, radius, angle - perfect * Math.PI * 1.5, angle + perfect * Math.PI * 1.5).stroke({ color: CYAN, width: 7, alpha: 0.9 })
      field.beginPath().arc(cx, cy, radius + 21, -Math.PI / 2, -Math.PI / 2 + Math.max(0.001, state.tick / 1200) * TAU).stroke({ color: GOLD, width: 2, alpha: 0.8 })
      for (let i = 0; i <= 30; i++) {
        const a = -Math.PI * 0.75 + i / 30 * Math.PI * 1.5
        field.moveTo(cx + Math.cos(a) * (radius - 22), cy + Math.sin(a) * (radius - 22)).lineTo(cx + Math.cos(a) * (radius - 27), cy + Math.sin(a) * (radius - 27)).stroke({ color: MUTED, width: 1, alpha: 0.7 })
      }
    } else if (state.config.challenge === 'slipstream') {
      for (let i = 0; i < 1; i++) {
        const y = cy - radius + state.phase / 65536 * radius * 1.65
        const opening = Math.max(22, safe * radius * 1.64)
        field.moveTo(cx - radius, y).lineTo(targetX - opening, y).moveTo(targetX + opening, y).lineTo(cx + radius, y).stroke({ color: CYAN, width: 3, alpha: 0.8 })
        field.circle(targetX, y, 3).fill({ color: CYAN, alpha: 0.65 })
      }
      field.moveTo(cx - radius, cy - radius).lineTo(cx - radius, cy + radius).moveTo(cx + radius, cy - radius).lineTo(cx + radius, cy + radius).stroke({ color: MUTED, width: 1, alpha: 0.5 })
    } else if (state.config.challenge === 'pulse-sync') {
      for (let i = 0; i < 1; i++) {
        const r = state.phase / 65536 * radius * 1.5
        field.circle(cx, cy, r).stroke({ color: CYAN, width: 2, alpha: 0.12 + (1 - r / (radius + 25)) * 0.6 })
      }
      field.circle(cx, cy, radius * 0.75).stroke({ color: GOLD, width: 2, alpha: 0.5 })
      for (let i = 0; i < 55; i++) {
        const x = cx - radius + i / 54 * radius * 2
        const y = cy + Math.sin(i * 0.5 + state.phase / 65536 * TAU) * 20
        if (i === 0) field.moveTo(x, y); else field.lineTo(x, y)
      }
      field.stroke({ color: CYAN, width: 2, alpha: 0.65 })
    } else if (state.config.challenge === 'sling') {
      field.beginPath().arc(cx, cy + radius * 0.55, radius, Math.PI, TAU).stroke({ color: MUTED, width: 2, alpha: 0.5 })
      const a = -Math.PI / 2
      field.moveTo(cx, cy + radius * 0.55).lineTo(cx + Math.cos(a) * radius, cy + radius * 0.55 + Math.sin(a) * radius).stroke({ color: CYAN, width: 3, alpha: 0.6 })
      field.circle(cx + Math.cos(a) * radius, cy + radius * 0.55 + Math.sin(a) * radius, 15).stroke({ color: CYAN, width: 2, alpha: 0.9 })
      field.roundRect(cx - radius, cy + radius * 0.8, radius * 2, 8, 4).fill({ color: MUTED, alpha: 0.3 })
      field.roundRect(cx - radius, cy + radius * 0.8, Math.max(1, state.power / 65536 * radius * 2), 8, 4).fill(GOLD)
      field.rect(cx - radius + 32000 / 65536 * radius * 2, cy + radius * 0.8 - 4, 28000 / 65536 * radius * 2, 16).stroke({ color: CYAN, width: 1, alpha: 0.8 })
      field.moveTo(cx - radius, cy + radius * 1.02).lineTo(cx - radius + state.phase / 65536 * radius * 2, cy + radius * 1.02).stroke({ color: GOLD, width: 2 })
      field.circle(cx, cy + radius * 1.02, 4).fill(CYAN)
    } else {
      for (let i = 0; i < 17; i++) {
        const x = cx - radius + i / 16 * radius * 2
        field.roundRect(x - 3, cy - radius * 0.8, 6, radius * 1.6, 3).fill({ color: MUTED, alpha: 0.08 + i % 3 * 0.03 })
      }
      field.rect(targetX - safe * radius * 1.64, cy - radius * 0.8, safe * radius * 3.28, radius * 1.6).fill({ color: CYAN, alpha: 0.1 })
      field.moveTo(targetX, cy - radius * 0.8).lineTo(targetX, cy + radius * 0.8).stroke({ color: CYAN, width: 2, alpha: 0.8 })
      field.moveTo(cx - radius, cy).lineTo(cx + radius, cy).stroke({ color: GOLD, width: 1, alpha: 0.35 })
    }
    // Smoothing is presentation-only; the engine state is never modified by the renderer.
    const alpha = controller.interpolation
    const displayPosition = (controller.getPreviousState().position * (1 - alpha) + state.position * alpha) / 65536
    let point = location(state, cx, cy, radius, displayPosition)
    if (state.config.challenge === 'sling' && lastInput === 1 && state.lastInput === 0 && snap.phase === 'playing') {
      const angle = -Math.PI + state.angle / 65536 * Math.PI
      launch = { x: point.x, y: point.y, vx: Math.cos(angle) * 7, vy: Math.sin(angle) * 7, life: 1 }
    }
    lastInput = state.lastInput
    if (launch && snap.phase === 'playing') {
      launch.x += launch.vx * dt; launch.y += launch.vy * dt; launch.vy += 0.12 * dt; launch.life -= 0.03 * dt
      point = { x: launch.x, y: launch.y }
      if (launch.life <= 0) launch = null
    }
    if (snap.phase === 'playing' && !reducedMotion) { history.push(point); if (history.length > 22) history.shift() }
    history.forEach((p, i) => trail.circle(p.x, p.y, 2 + i / history.length * 7).fill({ color: GOLD, alpha: i / history.length * 0.18 }))
    if (snap.ghost) {
      const ghost = location(snap.ghost, cx, cy, radius, snap.ghost.position / 65536)
      hex(ghost.x, ghost.y, 15, 0xdce5f5, 0.2)
      baton.circle(ghost.x, ghost.y, 21).stroke({ color: 0xdce5f5, width: 1, alpha: 0.25 })
    }
    const strikes = state.metrics.boundaryStrikes
    if ((state.combo > oldCombo || strikes > oldStrikes) && !reducedMotion) {
      const color = strikes > oldStrikes ? 0xe8890a : CYAN
      for (let i = 0; i < 12; i++) particles.push({ ...point, vx: Math.cos(i * TAU / 12) * 2.6, vy: Math.sin(i * TAU / 12) * 2.6, life: 1, color })
      shake = strikes > oldStrikes ? 3 : 1
    }
    oldCombo = state.combo; oldStrikes = strikes
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]
      if (!p) continue
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= 0.035 * dt
      if (p.life <= 0) particles.splice(i, 1); else baton.circle(p.x, p.y, 2).fill({ color: p.color, alpha: p.life })
    }
    hex(point.x, point.y, 31, GOLD, 0.035); hex(point.x, point.y, 24, GOLD, 0.09); hex(point.x, point.y, 15, GOLD, 1); hex(point.x, point.y, 8, 0xffe4a4, 0.9)
    shake *= 0.82
    app.stage.position.set(Math.sin(now * 0.08) * shake, Math.cos(now * 0.09) * shake)
    drawCalls = 0
    app.render()
    controller.measure(drawCalls, dpr, gl ? 'WebGL' : 'unknown')
    animation = requestAnimationFrame(frame)
  }
  animation = requestAnimationFrame(frame)
  const observer = new ResizeObserver(() => { app.renderer.resize(host.clientWidth, host.clientHeight); history.length = 0 })
  observer.observe(host)
  return () => {
    cancelAnimationFrame(animation); observer.disconnect()
    if (gl && originalArrays && originalElements) { gl.drawArrays = originalArrays; gl.drawElements = originalElements }
    if (gl2 && originalArraysInstanced && originalElementsInstanced) { gl2.drawArraysInstanced = originalArraysInstanced; gl2.drawElementsInstanced = originalElementsInstanced }
    app.destroy(true, { children: true })
  }
}
