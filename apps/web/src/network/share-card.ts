import type { BatonDetail } from '@nim-relay/shared'

/** Export only canonical journey facts; the QR-free URL also works from a saved image. */
export async function shareJourneyCard(detail: BatonDetail): Promise<void> {
  const { baton, handoffs } = detail
  const canvas = document.createElement('canvas')
  canvas.width = 1200; canvas.height = 630
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Your browser cannot create a journey card.')
  context.fillStyle = '#071322'; context.fillRect(0, 0, 1200, 630)
  context.strokeStyle = '#34485c'; context.lineWidth = 1
  for (let radius = 160; radius < 650; radius += 65) {
    context.beginPath(); context.arc(1060, 330, radius, 0, Math.PI * 2); context.stroke()
  }
  context.fillStyle = '#f5b743'; context.font = '700 24px system-ui'; context.fillText('NIM RELAY', 60, 64)
  context.fillStyle = '#f4f5f8'; context.font = '700 56px system-ui'
  const title = baton.title.length > 32 ? `${baton.title.slice(0, 31)}…` : baton.title
  context.fillText(title, 60, 155)
  context.fillStyle = '#c1cedc'; context.font = '24px system-ui'
  context.fillText(`${baton.value / 100000} NIM · ${baton.mode} · ${baton.status}`, 60, 205)
  context.fillStyle = '#f5b743'; context.font = '700 66px system-ui'
  context.fillText(String(baton.handoffCount), 60, 310)
  context.fillText(String(baton.lineage.runners), 340, 310)
  context.fillText(String(baton.lineage.countries.length), 620, 310)
  context.fillStyle = '#c1cedc'; context.font = '20px system-ui'
  context.fillText('confirmed handoffs', 60, 350)
  context.fillText('couriers', 340, 350)
  context.fillText('shared countries', 620, 350)
  const names = [baton.origin.name, ...handoffs.map(handoff => handoff.to.name)]
  context.fillText(names.slice(-5).join(' → ').slice(0, 83), 60, 420)
  context.font = '17px system-ui'
  context.fillText('Countries are optional network observations, not verified physical locations.', 60, 461)
  const url = new URL(`/relay/${baton.code}`, location.origin).href
  context.fillStyle = '#f5b743'; context.fillText(url, 60, 545)
  context.fillStyle = '#91a6bc'; context.fillText(baton.network === 'MainAlbatross' ? 'Mainnet · Every handoff independently verified' : 'Testnet evidence · Excluded from real mainnet usage', 60, 584)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not export this journey.')), 'image/png'))
  const file = new File([blob], `nim-relay-${baton.code}.png`, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) { await navigator.share({ title: baton.title, url, files: [file] }); return }
  const link = document.createElement('a'), objectUrl = URL.createObjectURL(blob)
  link.href = objectUrl; link.download = file.name; link.click()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}
