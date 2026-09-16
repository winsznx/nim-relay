import * as THREE from 'three'
import type { LiveView, StationViewData } from '../../view-model'
import { FONT, capBaseline, createCanvasDisplay, fitText, setFont } from '../display'
import type { StationKit } from '../kit'
import { PLACEMENT, placeSurface } from '../layout'
import { COLOR, INK } from '../palette'
import type { StationSurface } from '../types'
import { approach, at, createHitTarget, focusFrame } from './common'

const OUTER = { halfWidth: 1.5, shoulder: 2.55 }
const INNER = { halfWidth: 1.16, shoulder: 2.32 }
const DEPTH = 0.42
const BASE = 0.14
const INFO = { width: 256, height: 384 }

function archPath(path: THREE.Path | THREE.Shape, halfWidth: number, shoulder: number): void {
  path.moveTo(-halfWidth, 0)
  path.lineTo(halfWidth, 0)
  path.lineTo(halfWidth, shoulder)
  path.absarc(0, shoulder, halfWidth, 0, Math.PI, false)
  path.lineTo(-halfWidth, 0)
}

/** An arch onto the live Global Relay: the portal swirls cyan while a runner carries the baton. */
export function createLivePortal(kit: StationKit, reducedMotion: () => boolean): StationSurface {
  const root = new THREE.Group()
  root.name = 'live'
  const surface = placeSurface('live', root)
  const { tag } = PLACEMENT.live

  const frameShape = new THREE.Shape()
  archPath(frameShape, OUTER.halfWidth, OUTER.shoulder)
  const opening = new THREE.Path()
  archPath(opening, INNER.halfWidth, INNER.shoulder)
  frameShape.holes.push(opening)
  const frameGeometry = new THREE.ExtrudeGeometry(frameShape, { depth: DEPTH, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 32 })
  kit.structure.add(frameGeometry.translate(0, BASE, -DEPTH / 2), surface)
  kit.structure.add(new THREE.BoxGeometry(OUTER.halfWidth * 2 + 0.7, BASE, DEPTH + 1.1), at(surface, 0, BASE / 2, 0.2))

  const rimPoints = new THREE.Path()
  archPath(rimPoints, INNER.halfWidth - 0.03, INNER.shoulder)
  const rimCurve = new THREE.CatmullRomCurve3(
    rimPoints
      .getSpacedPoints(96)
      .filter(point => point.y > 0.001)
      .map(point => new THREE.Vector3(point.x, point.y + BASE, DEPTH / 2 + 0.02)),
  )
  const rimMaterial = kit.track(new THREE.MeshBasicMaterial({ color: COLOR.gold }))
  const rim = new THREE.Mesh(kit.track(new THREE.TubeGeometry(rimCurve, 160, 0.028, 5, false)), rimMaterial)
  root.add(rim)

  const info = kit.track(createCanvasDisplay(kit, INFO.width, INFO.height))
  const uniforms = {
    uTime: kit.uniforms.uTime,
    uLive: { value: 0 },
    uPace: { value: 1 },
    uCyan: { value: COLOR.cyan },
    uIdle: { value: new THREE.Color('#5a4a2c') },
    uInfo: { value: info.texture },
    uBounds: { value: new THREE.Vector2(INNER.halfWidth, INNER.shoulder + INNER.halfWidth) },
  }
  const portalShape = new THREE.Shape()
  archPath(portalShape, INNER.halfWidth, INNER.shoulder)
  const portal = new THREE.Mesh(
    kit.track(new THREE.ShapeGeometry(portalShape, 32)),
    kit.track(
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: /* glsl */ `
          varying vec2 vShape;
          void main() {
            vShape = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uLive;
          uniform float uPace;
          uniform vec3 uCyan;
          uniform vec3 uIdle;
          uniform sampler2D uInfo;
          uniform vec2 uBounds;
          varying vec2 vShape;
          void main() {
            vec2 uv = vec2((vShape.x + uBounds.x) / (2.0 * uBounds.x), vShape.y / uBounds.y);
            vec2 p = vec2(vShape.x, vShape.y - uBounds.y * 0.55);
            float r = length(p);
            float a = atan(p.y, p.x);
            float t = uTime * uPace;
            float bands = 0.5 + 0.5 * sin(a * 3.0 + r * 5.0 - t * 0.7);
            float fine = 0.5 + 0.5 * sin(a * 7.0 - r * 9.0 + t * 1.1);
            float energy = mix(bands, fine, 0.35) * smoothstep(2.4, 0.2, r);
            float edge = smoothstep(0.35, 0.0, min(uBounds.x - abs(vShape.x), vShape.y)) * 0.4;
            vec3 tint = mix(uIdle, uCyan, uLive);
            vec3 color = vec3(0.006, 0.01, 0.022) + tint * (energy * mix(0.1, 0.32, uLive) + edge * mix(0.3, 0.9, uLive));
            vec4 text = texture2D(uInfo, uv);
            color = mix(color, text.rgb, text.a);
            gl_FragColor = vec4(color, 1.0);
            #include <colorspace_fragment>
          }
        `,
        toneMapped: false,
      }),
    ),
  )
  portal.position.set(0, BASE, 0)
  root.add(portal)

  const emitterMaterial = kit.track(new THREE.MeshBasicMaterial({ map: kit.radial, color: COLOR.gold, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }))
  const emitter = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(3.4, 2.2).rotateX(-Math.PI / 2)), emitterMaterial)
  emitter.position.set(0, BASE + 0.01, 0.7)
  root.add(emitter)

  const hitTarget = createHitTarget(kit, root, [3.8, 5, 2.6], [0, 2.4, 0.4])
  const frame = focusFrame(root, [0, BASE + 2.0, DEPTH / 2], 3.2, 4.2)
  let live = 0
  let liveTarget = 0
  let glow = 0
  let glowTarget = 0

  return {
    id: 'live',
    root,
    hitTarget,
    frame,
    update(data: StationViewData) {
      info.paint(JSON.stringify(data.live), context => paintInfo(context, data.live))
      liveTarget = data.live.state === 'live' ? 1 : 0
    },
    setFocused(focused) {
      glowTarget = focused ? 1 : 0
    },
    tick(time, delta) {
      glow = approach(glow, glowTarget, delta, 4)
      kit.setLightGlow(tag, glow)
      live = approach(live, liveTarget, delta, 2)
      uniforms.uLive.value = live
      uniforms.uPace.value = reducedMotion() ? 0.25 : 1
      const breathe = reducedMotion() ? 0 : Math.sin(time * 1.6) * 0.12
      rimMaterial.color.copy(COLOR.gold).lerp(COLOR.cyan, live).multiplyScalar(1.6 + live * (0.8 + breathe) + glow * 0.8)
      emitterMaterial.color.copy(COLOR.gold).lerp(COLOR.cyan, live)
      emitterMaterial.opacity = 0.18 + live * 0.3
    },
    dispose() {
      root.removeFromParent()
    },
  }
}

function paintInfo(context: CanvasRenderingContext2D, live: LiveView): void {
  const { width } = INFO
  const centre = width / 2
  context.textAlign = 'center'
  if (live.state === 'idle') {
    setFont(context, 26, FONT.sign)
    context.fillStyle = INK.muted
    context.fillText('NO LIVE RELAY', centre, capBaseline(context, 176))
    setFont(context, 15, FONT.sign)
    context.fillStyle = INK.faint
    context.fillText('THE NEXT ONE STARTS', centre, capBaseline(context, 210))
    context.fillText('WITH A SINGLE RUNNER', centre, capBaseline(context, 230))
    return
  }

  setFont(context, 15, FONT.sign)
  const label = 'LIVE RELAY'
  const labelWidth = context.measureText(label).width
  context.fillStyle = INK.cyan
  context.beginPath()
  context.arc(centre - labelWidth / 2 - 9, 84, 3.5, 0, Math.PI * 2)
  context.fill()
  context.fillText(label, centre + 5, capBaseline(context, 84))

  setFont(context, 36, FONT.sign)
  context.fillStyle = live.yours ? INK.gold : INK.text
  context.fillText(fitText(context, (live.yours ? 'Your leg' : (live.runner ?? '')).toLocaleUpperCase('en-US'), width - 64), centre, capBaseline(context, 136))
  setFont(context, 13, FONT.sign)
  context.fillStyle = INK.muted
  context.fillText(live.yours ? 'YOU CARRY' : 'CARRIES', centre, capBaseline(context, 166))
  setFont(context, 20, FONT.sign)
  context.fillStyle = INK.text
  context.fillText(fitText(context, (live.journey ?? '').toLocaleUpperCase('en-US'), width - 56), centre, capBaseline(context, 190))

  setFont(context, 13, FONT.sign)
  context.fillStyle = INK.muted
  context.fillText('LEG', centre, capBaseline(context, 232))
  setFont(context, 46, FONT.figure)
  context.fillStyle = INK.text
  context.fillText(String(live.leg ?? ''), centre, capBaseline(context, 268))

  setFont(context, 15, FONT.sign)
  context.fillStyle = live.ghostReady ? INK.cyan : INK.muted
  context.fillText(live.ghostReady ? 'VERIFIED GHOST READY' : 'NO GHOST ON THIS LEG', centre, capBaseline(context, 318))
  if (live.lastPass) {
    setFont(context, 13, FONT.sign)
    context.fillStyle = INK.muted
    context.fillText(`LAST PASS ${live.lastPass.toLocaleUpperCase('en-US')} AGO`, centre, capBaseline(context, 342))
  }
}
