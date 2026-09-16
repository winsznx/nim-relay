import * as THREE from 'three'
import type { RankLine, RankingsView, StationViewData } from '../../view-model'
import { FONT, capBaseline, createCanvasDisplay, createDisplayMaterial, fitText, setFont } from '../display'
import type { StationKit } from '../kit'
import { PLACEMENT, placeSurface } from '../layout'
import { INK } from '../palette'
import type { StationSurface } from '../types'
import { approach, at, createHitTarget, focusFrame, roundedSlab } from './common'

const TOWER = { width: 1.9, height: 5.6, depth: 0.42 }
const FACE = { width: 1.62, height: 4.7, y: 3.05 }
const CANVAS = { width: 248, height: 720 }
const MARGIN = 16

/** A tall monolith of standings: season, today's Daily, and the batons that beat the most ghosts. */
export function createRankings(kit: StationKit): StationSurface {
  const root = new THREE.Group()
  root.name = 'rankings'
  const surface = placeSurface('rankings', root)
  const { tag } = PLACEMENT.rankings

  kit.structure.add(roundedSlab(TOWER.width, TOWER.height, TOWER.depth, 0.1, 0.03), at(surface, 0, TOWER.height / 2 + 0.16, 0))
  kit.structure.add(new THREE.BoxGeometry(TOWER.width + 0.5, 0.16, TOWER.depth + 0.6), at(surface, 0, 0.08, 0.05))
  kit.lights.add(new THREE.BoxGeometry(TOWER.width - 0.1, 0.03, 0.03), at(surface, 0, TOWER.height + 0.1, TOWER.depth / 2 + 0.02), tag)
  for (const side of [-1, 1]) {
    kit.lights.add(new THREE.BoxGeometry(0.018, FACE.height + 0.1, 0.018), at(surface, side * (FACE.width / 2 + 0.07), FACE.y, TOWER.depth / 2 + 0.02), tag)
  }

  const display = kit.track(createCanvasDisplay(kit, CANVAS.width, CANVAS.height))
  const face = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(FACE.width, FACE.height)), createDisplayMaterial(kit, display))
  face.position.set(0, FACE.y, TOWER.depth / 2 + 0.004)
  root.add(face)

  const hitTarget = createHitTarget(kit, root, [TOWER.width + 1.4, TOWER.height + 0.8, 2.4], [0, (TOWER.height + 0.8) / 2, 0.5])
  const frame = focusFrame(root, [0, FACE.y, TOWER.depth / 2], FACE.width + 0.4, FACE.height + 0.3, { turn: 0.12, elevation: 0.55 })
  let glow = 0
  let glowTarget = 0

  return {
    id: 'rankings',
    root,
    hitTarget,
    frame,
    update(data: StationViewData) {
      display.paint(JSON.stringify([data.signedIn, data.rankings]), context => paintRankings(context, data.rankings, data.signedIn))
    },
    setFocused(focused) {
      glowTarget = focused ? 1 : 0
    },
    tick(_time, delta) {
      glow = approach(glow, glowTarget, delta, 4)
      kit.setLightGlow(tag, glow)
    },
    dispose() {
      root.removeFromParent()
    },
  }
}

function paintRankings(context: CanvasRenderingContext2D, rankings: RankingsView, signedIn: boolean): void {
  context.fillStyle = INK.panel
  context.fillRect(0, 0, CANVAS.width, CANVAS.height)

  context.textAlign = 'left'
  setFont(context, 30, FONT.sign)
  context.fillStyle = INK.gold
  context.fillText('RANKINGS', MARGIN, capBaseline(context, 34))
  rule(context, 58)

  let y = 86
  y = section(context, y, 'SEASON', seasonNote(rankings, signedIn))
  y = lines(context, y, rankings.season.lines, signedIn ? 'NO RANKED RIDES YET' : 'SIGN IN TO SEE THE SEASON')
  rule(context, y + 4)

  y = section(context, y + 32, 'DAILY', rankings.daily.world.toLocaleUpperCase('en-US'))
  y = lines(context, y, rankings.daily.lines, 'NO OFFICIAL RIDES TODAY')
  rule(context, y + 4)

  y = section(context, y + 32, 'GHOST RECORDS', null)
  lines(context, y, rankings.ghosts, 'NO GHOSTS BEATEN YET')
}

function seasonNote(rankings: RankingsView, signedIn: boolean): string | null {
  if (!signedIn || rankings.season.rank === null || rankings.season.xp === null) return null
  return `${rankings.season.rank}  ${rankings.season.xp.toLocaleString('en')} XP`.toLocaleUpperCase('en-US')
}

function rule(context: CanvasRenderingContext2D, y: number): void {
  context.fillStyle = INK.panelEdge
  context.fillRect(MARGIN, y, CANVAS.width - MARGIN * 2, 1)
}

/** Section heading with an optional line beneath; returns where rows start. */
function section(context: CanvasRenderingContext2D, y: number, title: string, note: string | null): number {
  setFont(context, 17, FONT.sign)
  context.textAlign = 'left'
  context.fillStyle = INK.muted
  context.fillText(fitText(context, title.toLocaleUpperCase('en-US'), CANVAS.width - MARGIN * 2), MARGIN, capBaseline(context, y))
  if (!note) return y + 30
  setFont(context, 18, FONT.sign)
  context.fillStyle = INK.gold
  context.fillText(fitText(context, note, CANVAS.width - MARGIN * 2), MARGIN, capBaseline(context, y + 26))
  return y + 56
}

function lines(context: CanvasRenderingContext2D, y: number, entries: readonly RankLine[], empty: string): number {
  if (entries.length === 0) {
    setFont(context, 16, FONT.sign)
    context.textAlign = 'left'
    context.fillStyle = INK.faint
    context.fillText(empty, MARGIN, capBaseline(context, y + 8))
    return y + 30
  }
  const pitch = 34
  entries.forEach((entry, index) => {
    const rowY = y + 8 + index * pitch
    if (entry.you) {
      context.fillStyle = 'rgba(245, 166, 35, 0.12)'
      context.fillRect(MARGIN - 6, rowY - 15, CANVAS.width - (MARGIN - 6) * 2, 30)
    }
    setFont(context, 19, FONT.figure)
    context.textAlign = 'left'
    context.fillStyle = entry.place === 1 ? INK.gold : INK.muted
    context.fillText(String(entry.place), MARGIN, capBaseline(context, rowY))
    setFont(context, 18, FONT.figure)
    context.textAlign = 'right'
    context.fillStyle = INK.text
    context.fillText(entry.value, CANVAS.width - MARGIN, capBaseline(context, rowY))
    const valueWidth = context.measureText(entry.value).width
    setFont(context, 20, FONT.sign)
    context.textAlign = 'left'
    context.fillStyle = entry.you ? INK.gold : INK.text
    context.fillText(fitText(context, entry.name.toLocaleUpperCase('en-US'), CANVAS.width - MARGIN * 2 - 30 - valueWidth - 10), MARGIN + 26, capBaseline(context, rowY))
  })
  return y + entries.length * pitch
}
