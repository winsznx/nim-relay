import type { RelayNetwork } from '@nim-relay/shared'
import { formatCount, formatDuration, formatNim } from './format'

export interface ShareCardFacts {
  code: string
  identity: string
  name: string
  network: RelayNetwork
  valueLuna: number
  handoffs: number
  transactingWallets: number
  countries: number
  aliveMs: number
  route: string
  runnerNames: readonly string[]
}

const WIDTH = 1200
const HEIGHT = 630
const FONT = '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif'

function fit(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text
  let trimmed = text
  while (trimmed.length > 1 && context.measureText(`${trimmed}…`).width > maxWidth) trimmed = trimmed.slice(0, -1)
  return `${trimmed}…`
}

function hexagon(context: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  context.beginPath()
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2
    const px = x + radius * Math.cos(angle)
    const py = y + radius * Math.sin(angle)
    if (i === 0) context.moveTo(px, py)
    else context.lineTo(px, py)
  }
  context.closePath()
}

/** Draws a share image from public, verified journey facts only, then shares or downloads it. */
export async function shareJourneyCard(facts: ShareCardFacts): Promise<void> {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser can’t draw the journey card. Share the link instead.')

  const background = context.createRadialGradient(930, 300, 40, 930, 300, 700)
  background.addColorStop(0, '#16213d')
  background.addColorStop(1, '#05070f')
  context.fillStyle = background
  context.fillRect(0, 0, WIDTH, HEIGHT)
  context.strokeStyle = 'rgba(214, 226, 255, 0.08)'
  context.lineWidth = 1
  for (let radius = 150; radius < 620; radius += 58) {
    context.beginPath()
    context.arc(960, 315, radius, 0, Math.PI * 2)
    context.stroke()
  }
  const glow = context.createRadialGradient(960, 315, 0, 960, 315, 150)
  glow.addColorStop(0, 'rgba(245, 166, 35, 0.45)')
  glow.addColorStop(1, 'rgba(245, 166, 35, 0)')
  context.fillStyle = glow
  context.fillRect(760, 115, 400, 400)
  const core = context.createLinearGradient(900, 240, 1020, 390)
  core.addColorStop(0, '#ffd98a')
  core.addColorStop(0.5, '#f5a623')
  core.addColorStop(1, '#b8650a')
  context.fillStyle = core
  hexagon(context, 960, 315, 78)
  context.fill()

  context.fillStyle = '#ffd48c'
  context.font = `700 22px ${FONT}`
  context.letterSpacing = '4px'
  context.fillText(facts.identity.toUpperCase(), 64, 84)
  context.letterSpacing = '0px'
  context.fillStyle = '#f5f7fa'
  context.font = `760 64px ${FONT}`
  context.fillText(fit(context, facts.route, 700), 64, 168)
  context.fillStyle = '#9aa3b8'
  context.font = `400 26px ${FONT}`
  context.fillText(fit(context, `${facts.name}, carrying ${formatNim(facts.valueLuna)}`, 700), 64, 214)

  const stats: [string, string][] = [
    [formatCount(facts.handoffs), 'verified handoffs'],
    [formatCount(facts.transactingWallets), 'transacting wallets'],
    [formatCount(facts.countries), 'network-observed countries'],
    [formatDuration(facts.aliveMs), 'alive'],
  ]
  stats.forEach(([value, label], index) => {
    const x = 64 + index * 176
    context.fillStyle = '#ffd48c'
    context.font = `720 50px ${FONT}`
    context.fillText(value, x, 330)
    context.fillStyle = '#9aa3b8'
    context.font = `400 18px ${FONT}`
    context.fillText(fit(context, label, 160), x, 362)
  })

  context.fillStyle = '#c9d0de'
  context.font = `500 24px ${FONT}`
  context.fillText(fit(context, facts.runnerNames.slice(-6).join('  →  '), 700), 64, 440)
  context.fillStyle = '#737c92'
  context.font = `400 17px ${FONT}`
  context.fillText('Countries are optional, consented network observations, never exact locations.', 64, 476)

  const url = new URL(`/chronicle/${facts.code}`, window.location.origin).href
  context.fillStyle = '#f5a623'
  context.font = `600 22px ${FONT}`
  context.fillText(url, 64, 560)
  context.fillStyle = '#9aa3b8'
  context.font = `400 18px ${FONT}`
  context.fillText(facts.network === 'MainAlbatross' ? 'Nimiq mainnet. Every handoff independently verified.' : 'Nimiq testnet evidence, kept separate from mainnet usage.', 64, 592)

  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => (result ? resolve(result) : reject(new Error('The journey card couldn’t be exported. Share the link instead.'))), 'image/png'))
  const file = new File([blob], `nim-relay-${facts.code}.png`, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title: facts.name, url, files: [file] })
    return
  }
  const link = document.createElement('a')
  const objectUrl = URL.createObjectURL(blob)
  link.href = objectUrl
  link.download = file.name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}
