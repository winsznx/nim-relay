import { showToast } from './toast'

const CLIPBOARD_UNAVAILABLE = 'Copying isn’t available in this browser. Share the page address instead.'

/** Opens the system share sheet, or copies the link where sharing is unavailable. */
export async function shareLink(title: string, path: string): Promise<void> {
  const url = new URL(path, window.location.origin).href
  if (navigator.share) {
    await navigator.share({ title, url })
    return
  }
  await copyText(url, 'Link copied.')
}

export async function copyText(text: string, confirmation: string): Promise<void> {
  // Clipboard access is missing outside secure contexts, whatever the DOM types say.
  if (!('clipboard' in navigator) || !navigator.clipboard) throw new Error(CLIPBOARD_UNAVAILABLE)
  await navigator.clipboard.writeText(text)
  showToast(confirmation, 'success')
}
