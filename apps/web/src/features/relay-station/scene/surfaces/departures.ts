import * as THREE from 'three'
import type { DepartureRow, StationViewData } from '../../view-model'
import { createCanvasDisplay, createDisplayMaterial } from '../display'
import type { StationKit } from '../kit'
import { PLACEMENT, placeSurface } from '../layout'
import type { StationSurface } from '../types'
import { approach, at, createHitTarget, focusFrame, roundedSlab } from './common'
import { BOARD_CANVAS, SHUFFLE_MS, paintBoard } from './departures-board'

const FACE_WIDTH = 3.7
const FACE_HEIGHT = 2.25
const BOARD_Y = 3.15
const HOUSING_DEPTH = 0.3
const SHUFFLE_STEP_MS = 70

/** A freestanding split-flap board on two pylons, under a lit canopy. */
export function createDepartures(kit: StationKit, reducedMotion: () => boolean): StationSurface {
  const root = new THREE.Group()
  root.name = 'departures'
  const surface = placeSurface('departures', root)
  const { tag } = PLACEMENT.departures
  const top = BOARD_Y + FACE_HEIGHT / 2
  const bottom = BOARD_Y - FACE_HEIGHT / 2

  kit.structure.add(roundedSlab(FACE_WIDTH + 0.3, FACE_HEIGHT + 0.32, HOUSING_DEPTH, 0.08), at(surface, 0, BOARD_Y, 0))
  kit.structure.add(new THREE.BoxGeometry(FACE_WIDTH + 0.7, 0.08, 0.8), at(surface, 0, top + 0.36, 0.18))
  for (const side of [-1, 1]) {
    const x = side * (FACE_WIDTH / 2 - 0.45)
    kit.structure.add(new THREE.BoxGeometry(0.15, bottom + 0.1, 0.15), at(surface, x, (bottom + 0.1) / 2, -0.04))
    kit.structure.add(new THREE.BoxGeometry(0.44, 0.08, 0.44), at(surface, x, 0.04, -0.04))
    kit.structure.add(new THREE.BoxGeometry(0.08, 0.36, 0.08), at(surface, side * (FACE_WIDTH / 2 + 0.2), top + 0.22, 0.02))
  }
  const front = HOUSING_DEPTH / 2 + 0.005
  kit.lights.add(new THREE.BoxGeometry(FACE_WIDTH + 0.3, 0.022, 0.024), at(surface, 0, top + 0.16, front), tag)
  kit.lights.add(new THREE.BoxGeometry(FACE_WIDTH + 0.3, 0.022, 0.024), at(surface, 0, bottom - 0.16, front), tag)
  kit.lights.add(new THREE.BoxGeometry(FACE_WIDTH + 0.5, 0.02, 0.03), at(surface, 0, top + 0.31, 0.56), tag)

  const display = kit.track(createCanvasDisplay(kit, BOARD_CANVAS.width, BOARD_CANVAS.height))
  const face = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(FACE_WIDTH, FACE_HEIGHT)), createDisplayMaterial(kit, display))
  face.position.set(0, BOARD_Y, front + 0.002)
  root.add(face)

  const hitTarget = createHitTarget(kit, root, [FACE_WIDTH + 1.2, top + 0.9, 2.2], [0, (top + 0.9) / 2, 0.4])
  const frame = focusFrame(root, [0, BOARD_Y, front], FACE_WIDTH + 0.3, FACE_HEIGHT + 0.5)

  let rows: readonly DepartureRow[] = []
  let network: StationViewData['network'] = 'TestAlbatross'
  let changed = new Set<number>()
  let shuffleStart = -1
  let lastStep = -1
  let clock = 0
  let glow = 0
  let glowTarget = 0

  function settledPaint(): void {
    display.repaint(context => paintBoard(context, { rows, network, shuffleMs: null, changed }))
  }

  return {
    id: 'departures',
    root,
    hitTarget,
    frame,
    update(data) {
      const key = JSON.stringify([data.network, data.departures])
      const previous = rows
      rows = data.departures
      network = data.network
      const painted = display.paint(key, context => paintBoard(context, { rows, network, shuffleMs: null, changed: new Set() }))
      if (!painted || !kit.settings.boardShuffle || reducedMotion()) return
      changed = new Set(rows.flatMap((row, index) => (JSON.stringify(row) === JSON.stringify(previous[index]) ? [] : [index])))
      if (changed.size === 0) return
      shuffleStart = clock
      lastStep = -1
    },
    setFocused(focused) {
      glowTarget = focused ? 1 : 0
    },
    tick(time, delta) {
      clock = time
      glow = approach(glow, glowTarget, delta, 4)
      kit.setLightGlow(tag, glow)
      if (shuffleStart < 0) return
      const elapsedMs = (time - shuffleStart) * 1000
      if (elapsedMs >= SHUFFLE_MS) {
        shuffleStart = -1
        settledPaint()
        return
      }
      const step = Math.floor(elapsedMs / SHUFFLE_STEP_MS)
      if (step === lastStep) return
      lastStep = step
      display.repaint(context => paintBoard(context, { rows, network, shuffleMs: elapsedMs, changed }))
    },
    dispose() {
      root.removeFromParent()
    },
  }
}
