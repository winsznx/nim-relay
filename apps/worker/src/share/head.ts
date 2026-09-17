import type { PageMeta } from './meta'

const OG_WIDTH = '1200'
const OG_HEIGHT = '630'

/** Meta elements we own. Existing copies in index.html are removed so crawlers read exactly one of each. */
const OWNED_PROPERTIES = new Set(['og:title', 'og:description', 'og:url', 'og:image', 'og:image:width', 'og:image:height', 'og:image:alt', 'og:type', 'og:site_name'])
const OWNED_NAMES = new Set(['description', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt'])

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function metaTags(meta: PageMeta): string {
  const property = (key: string, value: string) => `<meta property="${key}" content="${escapeAttribute(value)}" />`
  const name = (key: string, value: string) => `<meta name="${key}" content="${escapeAttribute(value)}" />`
  return [
    name('description', meta.description),
    property('og:type', 'website'),
    property('og:site_name', 'NIM Relay'),
    property('og:title', meta.title),
    property('og:description', meta.description),
    property('og:url', meta.url),
    property('og:image', meta.image),
    property('og:image:width', OG_WIDTH),
    property('og:image:height', OG_HEIGHT),
    property('og:image:alt', meta.imageAlt),
    name('twitter:card', 'summary_large_image'),
    name('twitter:title', meta.title),
    name('twitter:description', meta.description),
    name('twitter:image', meta.image),
    name('twitter:image:alt', meta.imageAlt),
    `<link rel="canonical" href="${escapeAttribute(meta.url)}" />`,
  ].join('')
}

/** Rewrites the app shell's head so link previews show this page's title, description and image. */
export function withPageMeta(shell: Response, meta: PageMeta): Response {
  const rewritten = new HTMLRewriter()
    .on('title', {
      element(element) {
        element.setInnerContent(meta.title)
      },
    })
    .on('meta', {
      element(element) {
        const property = element.getAttribute('property')
        const name = element.getAttribute('name')
        if ((property && OWNED_PROPERTIES.has(property)) || (name && OWNED_NAMES.has(name))) element.remove()
      },
    })
    .on('link[rel="canonical"]', {
      element(element) {
        element.remove()
      },
    })
    .on('head', {
      element(element) {
        element.append(metaTags(meta), { html: true })
      },
    })
    .transform(shell)
  const headers = new Headers(rewritten.headers)
  headers.set('Cache-Control', 'no-cache')
  headers.delete('Content-Length')
  return new Response(rewritten.body, { status: 200, headers })
}
