/** The NIM Relay baton emblem: a luminous gold hexagon core with an arcing comet trail. */
const GOLD_GRADIENT = `
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ffe3a1"/><stop offset="0.45" stop-color="#f5a623"/><stop offset="1" stop-color="#b8650a"/>
  </linearGradient>`

export function emblemSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="0.5" cy="0.42" r="0.75">
      <stop offset="0" stop-color="#1c2a4d"/><stop offset="0.6" stop-color="#0d1426"/><stop offset="1" stop-color="#070b16"/>
    </radialGradient>
    ${GOLD_GRADIENT}
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#f5a623" stop-opacity="0.55"/><stop offset="1" stop-color="#f5a623" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="trail" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#f5a623" stop-opacity="0"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0.95"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <circle cx="256" cy="268" r="210" fill="none" stroke="#2a3a63" stroke-width="3" opacity="0.8"/>
  <path d="M70 360 C 150 250, 250 205, 300 214" fill="none" stroke="url(#trail)" stroke-width="14" stroke-linecap="round"/>
  <circle cx="330" cy="222" r="120" fill="url(#glow)"/>
  <g transform="translate(330 222)">
    <polygon points="-58,-100 58,-100 116,0 58,100 -58,100 -116,0" transform="scale(0.62)" fill="url(#gold)"/>
    <polygon points="-58,-100 58,-100 116,0 58,100 -58,100 -116,0" transform="scale(0.36)" fill="none" stroke="#fff4d6" stroke-width="10" opacity="0.85"/>
  </g>
  <circle cx="70" cy="360" r="11" fill="#22d3ee"/>
</svg>`
}
