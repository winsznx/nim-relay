/**
 * Renders NIM Relay brand images from inline SVG with headless Chromium:
 * the app icon (favicon, touch icon, competition icon) and the listing thumbnail.
 *
 * Usage: node scripts/submission/brand.mjs [liveUrl]
 * Writes apps/web/public/{favicon.svg,apple-touch-icon.png,icon-512.png} and docs/submission/{icon.png,thumbnail.png}.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(resolve(root, 'apps/web/package.json'))
const { chromium } = require('@playwright/test')
const liveUrl = process.argv[2] ?? 'https://nim-relay-testnet.timjosh507.workers.dev'

const GOLD_GRADIENT = `
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ffe3a1"/><stop offset="0.45" stop-color="#f5a623"/><stop offset="1" stop-color="#b8650a"/>
  </linearGradient>`

/** The baton emblem: a luminous gold hexagon core with an arcing comet trail. */
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

async function render(page, svg, width, height, path) {
  await page.setViewportSize({ width, height })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
  const buffer = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width, height } })
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, buffer)
}

async function captureScreens(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  await page.goto(`${liveUrl}/leg/practice`)
  await page.waitForSelector('main.leg[data-phase="racing"]', { timeout: 120000 })
  await page.waitForTimeout(9000)
  const race = await page.screenshot({ type: 'png' })
  await page.goto(liveUrl)
  await page.waitForSelector('[data-map-ready="true"]', { timeout: 60000 })
  await page.waitForTimeout(2500)
  const world = await page.screenshot({ type: 'png' })
  await context.close()
  return { race: race.toString('base64'), world: world.toString('base64') }
}

function thumbnailHtml(screens) {
  const phone = (b64, rotate, x) => `<div style="position:absolute;left:${x}px;top:120px;width:300px;height:649px;border-radius:44px;overflow:hidden;border:6px solid #1d2742;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 60px rgba(245,166,35,.15);transform:rotate(${rotate}deg)"><img src="data:image/png;base64,${b64}" style="width:100%;height:100%;object-fit:cover"/></div>`
  return `<html><head><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;800;900&display=swap" rel="stylesheet"></head>
  <body style="margin:0;width:1536px;height:864px;overflow:hidden;background:radial-gradient(120% 120% at 30% 40%,#18254a 0%,#0b1122 55%,#060a14 100%);font-family:Inter,system-ui,sans-serif;color:#f5f7fa;position:relative">
    <div style="position:absolute;left:96px;top:150px;width:640px">
      <div style="display:flex;align-items:center;gap:18px;margin-bottom:42px">${emblemSvg(84)}<span style="font-weight:800;letter-spacing:.32em;font-size:30px">NIM RELAY</span></div>
      <div style="font-weight:900;font-size:78px;line-height:.98;letter-spacing:-.02em">How far can<br/>one NIM <span style="color:#f5a623">travel?</span></div>
      <div style="margin-top:34px;font-size:28px;line-height:1.4;color:#c5cbe0;font-weight:500">Receive a real NIM baton. Race the last runner’s verified ghost. Pass it on with Nimiq Pay.</div>
      <div style="margin-top:40px;display:inline-flex;align-items:center;gap:12px;padding:12px 22px;border-radius:999px;border:1px solid rgba(34,211,238,.45);color:#22d3ee;font-weight:800;letter-spacing:.14em;font-size:18px"><span style="width:10px;height:10px;border-radius:50%;background:#22d3ee"></span>EVERY HANDOFF VERIFIED ON NIMIQ</div>
    </div>
    ${phone(screens.world, -4, 900)}
    ${phone(screens.race, 5, 1170)}
  </body></html>`
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
const page = await browser.newPage()
writeFileSync(resolve(root, 'apps/web/public/favicon.svg'), emblemSvg(512))
await render(page, emblemSvg(180), 180, 180, resolve(root, 'apps/web/public/apple-touch-icon.png'))
await render(page, emblemSvg(512), 512, 512, resolve(root, 'apps/web/public/icon-512.png'))
await render(page, emblemSvg(512), 512, 512, resolve(root, 'docs/submission/icon.png'))
const screens = await captureScreens(browser)
await page.setViewportSize({ width: 1536, height: 864 })
await page.setContent(thumbnailHtml(screens), { waitUntil: 'networkidle' })
writeFileSync(resolve(root, 'docs/submission/thumbnail.png'), await page.screenshot({ type: 'png' }))
await browser.close()
console.log('brand images written')
