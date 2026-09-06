import { Application, Graphics } from 'pixi.js'
import { relayRun } from '@nim-relay/game-engine'
import type { RelayRunController } from './controller'

type RouteModule = relayRun.RouteModule

const GOLD = 0xf5a623
const CYAN = 0x22d3ee
const RED = 0xff5a54
const MUTED = 0x3a4560
const ONE = 65536

const PX_PER_TICK = 0.62

/** signed triangle in [-1,1], matches the engine osc shape closely enough for visuals */
function osc(t: number, p: number): number {
  const q = ((t % p) + p) % p
  const half = p / 2
  const ramp = q < half ? q : p - q
  return (ramp / half) * 2 - 1
}

export async function mountRelayRenderer(host: HTMLElement, controller: RelayRunController): Promise<() => void> {
  const app = new Application()
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  await app.init({ resizeTo: host, backgroundAlpha: 0, antialias: true, resolution: dpr, autoDensity: true, preference: 'webgl', autoStart: false })
  host.appendChild(app.canvas)

  const bg = new Graphics()
  const route = new Graphics()
  const ghost = new Graphics()
  const baton = new Graphics()
  const fx = new Graphics()
  app.stage.addChild(bg, route, ghost, baton, fx)

  const mods = relayRun.composeRoute(controller.config.seed, controller.config.legNumber, relayRun.deriveCarryState(controller.config.prevLeg ?? null))
  const allGates = mods.flatMap((m) => m.gates)
  const stars: { x: number; y: number; r: number }[] = []
  for (let i = 0; i < 60; i++) stars.push({ x: (i * 97) % 400, y: (i * 53) % 800, r: (i % 3) * 0.4 + 0.3 })

  let draws = 0
  const trail: { x: number; y: number }[] = []

  const render = (): void => {
    draws = 0
    const s = controller.getRenderSnapshot()
    const w = app.screen.width
    const h = app.screen.height
    const cx = w / 2
    const batonY = h * 0.76
    const spanX = w * 0.42
    const state = s.state
    const p = state.tick + controller.interpolation
    const sx = (x: number): number => cx + (x / ONE) * spanX
    const sy = (tick: number): number => batonY - (tick - p) * PX_PER_TICK

    bg.clear()
    bg.rect(0, 0, w, h).fill({ color: 0x0a0e1a })
    for (const st of stars) {
      const yy = (st.y + p * 0.25) % h
      bg.circle(st.x % w, yy, st.r).fill({ color: 0x223, alpha: 0.7 })
    }
    // centre guide
    bg.moveTo(cx, 0).lineTo(cx, h).stroke({ color: MUTED, width: 1, alpha: 0.25 })
    draws++

    // ── route ahead ──
    route.clear()
    const mod = mods.find((m) => state.tick >= m.startTick && state.tick < m.endTick) ?? mods[mods.length - 1]!
    drawModule(route, mod, sx, sy, state.tick, w)
    const nextMod = mods[mods.indexOf(mod) + 1]
    if (nextMod && sy(nextMod.startTick) > -80) drawModule(route, nextMod, sx, sy, state.tick, w)
    for (const g of allGates) {
      const gy = sy(g.tick)
      if (gy < -40 || gy > h + 40) continue
      const beatOpen = g.beat > 0 ? osc(g.tick, g.beat) > 0 : true
      const rad = ((g.beat > 0 && !beatOpen ? g.radius / 3 : g.radius) / ONE) * spanX
      const col = g.beat > 0 ? CYAN : GOLD
      route.circle(sx(g.x), gy, rad).stroke({ color: col, width: 2, alpha: 0.5 })
      route.circle(sx(g.x), gy, (g.core / ONE) * spanX).stroke({ color: col, width: 2, alpha: 0.9 })
      draws++
    }

    // ── ghost ──
    ghost.clear()
    if (s.ghost && !s.ghostHidden) {
      const gx = sx(s.ghost.x)
      ghost.circle(gx, batonY, 9).fill({ color: 0x9fb0d0, alpha: 0.35 })
      ghost.circle(gx, batonY, 9).stroke({ color: 0xcdd8f0, width: 1.5, alpha: 0.5 })
      draws++
    }

    // ── baton + trail ──
    baton.clear()
    const bx = sx(state.x)
    trail.push({ x: bx, y: batonY })
    if (trail.length > 26) trail.shift()
    for (let i = 1; i < trail.length; i++) {
      const a = i / trail.length
      baton.moveTo(trail[i - 1]!.x, batonY + (trail.length - i) * 5)
        .lineTo(trail[i]!.x, batonY + (trail.length - i - 1) * 5)
        .stroke({ color: GOLD, width: 1 + a * 3, alpha: a * 0.5 })
    }
    const overheating = state.overheatTicks > 0
    const hexR = 12
    baton.regularPoly(bx, batonY, hexR, 6, Math.PI / 6).fill({ color: overheating ? RED : GOLD })
    baton.regularPoly(bx, batonY, hexR + 5, 6, Math.PI / 6).stroke({ color: overheating ? RED : GOLD, width: 2, alpha: 0.4 })
    draws++

    // ── phase-specific overlays ──
    fx.clear()
    if (s.phase === 'countdown' || mod.kind === 'catch') {
      const retX = sx(Math.round(osc(state.tick, 120) * ONE * 0.62))
      fx.circle(retX, batonY - 30, 26 - (state.tick % 30)).stroke({ color: CYAN, width: 2, alpha: 0.8 })
      draws++
    }
    if (mod.kind === 'sling') {
      const angle = (state.slingAngle / ONE) * 0.9 - Math.PI / 2
      const len = 40 + (state.slingPower / ONE) * 120
      fx.moveTo(bx, batonY).lineTo(bx + Math.cos(angle) * len, batonY + Math.sin(angle) * len)
        .stroke({ color: GOLD, width: 3, alpha: 0.85 })
      fx.rect(cx - 60, h * 0.9, 120 * (state.slingPower / ONE), 6).fill({ color: GOLD })
      fx.rect(cx - 60, h * 0.9, 120, 6).stroke({ color: MUTED, width: 1 })
      draws++
    }
    if (mod.kind === 'turbulence') {
      fx.rect(0, sy(mod.endTick), w, sy(mod.startTick) - sy(mod.endTick)).fill({ color: CYAN, alpha: 0.05 })
      draws++
    }

    controller.measure(draws)
  }

  let raf = 0
  const loop = (now: number): void => {
    controller.frame(now)
    render()
    app.renderer.render(app.stage)
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)

  return () => {
    cancelAnimationFrame(raf)
    app.destroy(true, { children: true })
  }
}

function drawModule(g: Graphics, m: RouteModule, sx: (x: number) => number, sy: (t: number) => number, tick: number, w: number): void {
  const top = sy(m.endTick)
  const bot = sy(m.startTick)
  if (m.kind === 'fork') {
    const midY = (top + bot) / 2
    g.moveTo(sx(0), bot).lineTo(sx(-ONE * 0.55), midY).lineTo(sx(-ONE * 0.55), top).stroke({ color: MUTED, width: 2, alpha: 0.5 })
    g.moveTo(sx(0), bot).lineTo(sx(ONE * 0.55), midY).lineTo(sx(ONE * 0.55), top).stroke({ color: MUTED, width: 2, alpha: 0.5 })
    const tightX = m.tightSide === 1 ? ONE * 0.55 : -ONE * 0.55
    g.circle(sx(tightX), midY, 4).fill({ color: 0xff5a54, alpha: 0.8 })
  } else if (m.kind === 'turbulence') {
    const prog = Math.max(0, Math.min(1, (tick - m.startTick) / (m.endTick - m.startTick)))
    const hw = (m.corridorEnd + (ONE * 0.42 - m.corridorEnd) * (1 - prog)) / ONE
    g.moveTo(sx(-hw * ONE), top).lineTo(sx(-hw * ONE), bot).stroke({ color: CYAN, width: 2, alpha: 0.6 })
    g.moveTo(sx(hw * ONE), top).lineTo(sx(hw * ONE), bot).stroke({ color: CYAN, width: 2, alpha: 0.6 })
  }
  void w
}
