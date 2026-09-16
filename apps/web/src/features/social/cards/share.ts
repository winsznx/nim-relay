import { trackShare } from '../../relays/data'
import { showToast } from '../../shell/toast'
import { cardLayout, type ShareCard } from './layout'
import { renderCard } from './render'

function download(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

async function copyLink(url: string): Promise<boolean> {
  // Clipboard access is missing outside secure contexts, whatever the DOM types say.
  if (!('clipboard' in navigator) || !navigator.clipboard) return false
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch (error) {
    console.warn('Card link not copied', error)
    return false
  }
}

/**
 * Opens the share sheet. False when the browser refuses because the tap that
 * started the share has expired; a dismissed sheet still rejects with AbortError.
 */
async function shareSheet(data: ShareData): Promise<boolean> {
  try {
    await navigator.share(data)
    return true
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') return false
    throw error
  }
}

/**
 * Shares a card the best way the device allows: the image with its deep link
 * through the share sheet, else the link alone, else the image downloads and
 * the link is copied. Every completed share is counted; a dismissed one isn't.
 */
export async function shareCard(card: ShareCard): Promise<void> {
  const layout = cardLayout(card)
  const url = new URL(layout.path, window.location.origin).href
  const blob = await renderCard(layout, url)
  const file = new File([blob], layout.fileName, { type: 'image/png' })
  let shared = false
  if (navigator.canShare?.({ files: [file] })) shared = await shareSheet({ title: layout.title, text: `${layout.text} ${url}`, files: [file] })
  // The Web Share API is missing on many desktop browsers, whatever the DOM types say.
  else if ('share' in navigator) shared = await shareSheet({ title: layout.title, text: layout.text, url })
  if (!shared) {
    download(blob, layout.fileName)
    showToast((await copyLink(url)) ? 'Card saved and link copied.' : 'Card saved to your downloads.', 'success')
  }
  trackShare(layout.surface)
}
