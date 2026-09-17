/**
 * Renders the 1200x630 link preview images served at /og/*.png from a real race frame.
 *
 * Needs the web dev server (it uses the development-only race lab):
 *   pnpm --filter @nim-relay/web exec vite --host 127.0.0.1 --port 5190
 *   node scripts/submission/og.mjs [http://127.0.0.1:5190]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { emblemSvg } from './emblem.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(resolve(root, 'apps/web/package.json'))
const { chromium } = require('@playwright/test')
const devServer = process.argv[2] ?? 'http://127.0.0.1:5190'
const outDir = resolve(root, 'apps/web/public/og')

const VARIANTS = {
  default: { kicker: 'A living relay game on Nimiq', title: 'How far can<br/>one NIM <em>travel?</em>', body: 'Race the last runner’s verified ghost. Pass a real NIM baton with Nimiq Pay.', badge: 'Every handoff verified on Nimiq' },
  relay: { kicker: 'Live relay', title: 'Carry the<br/><em>baton.</em>', body: 'Race the ghost of the runner before you, then pass 1 NIM to the next human.', badge: 'Verified on Nimiq' },
  daily: { kicker: 'Daily Relay', title: 'One course.<br/><em>Everyone.</em>', body: 'One official run a day, replayed by the server. Beat the ghost above you.', badge: 'Server-verified times' },
  invite: { kicker: 'You’re invited', title: 'Keep it<br/><em>moving.</em>', body: 'Receive 1 NIM, beat their ghost, and pass the baton on with Nimiq Pay.', badge: 'Join the relay' },
}

async function captureScene(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  await page.routeWebSocket(/.*/, () => {})
  await page.goto(`${devServer}/dev/leg?world=coast&tier=1&seed=og-coast&bot=1&ghost=1&quality=high`)
  await page.waitForSelector('main.leg[data-phase="racing"]', { timeout: 120000 })
  await page.addStyleTag({ content: 'main.leg > :not(.leg__scene) { display: none !important; }' })
  await page.waitForTimeout(11000)
  const buffer = await page.screenshot({ type: 'png' })
  await page.close()
  return buffer.toString('base64')
}

function html(scene, variant) {
  return `<html><head><link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&display=swap" rel="stylesheet"></head>
  <body style="margin:0;width:1200px;height:630px;overflow:hidden;position:relative;font-family:Inter,system-ui,sans-serif;color:#f5f7fa;background:#070b16">
    <img src="data:image/png;base64,${scene}" style="position:absolute;top:0;left:250px;width:1200px;height:630px;object-fit:cover;transform:scale(1.12);transform-origin:40% 60%"/>
    <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(6,9,19,1) 0%,rgba(6,9,19,.94) 34%,rgba(6,9,19,.35) 58%,rgba(6,9,19,0) 78%)"></div>
    <div style="position:absolute;inset:auto 0 0 0;height:120px;background:linear-gradient(0deg,rgba(6,9,19,.7),rgba(6,9,19,0))"></div>
    <div style="position:absolute;left:72px;top:64px;display:flex;align-items:center;gap:16px">${emblemSvg(64)}<span style="font-weight:800;letter-spacing:.32em;font-size:24px">NIM RELAY</span></div>
    <div style="position:absolute;left:72px;top:176px;width:620px">
      <div style="font-weight:700;letter-spacing:.2em;text-transform:uppercase;font-size:18px;color:#f5a623">${variant.kicker}</div>
      <div style="margin-top:14px;font-weight:900;font-size:78px;line-height:.98;letter-spacing:-.02em">${variant.title.replaceAll('<em>', '<span style="color:#f5a623;font-style:normal">').replaceAll('</em>', '</span>')}</div>
      <div style="margin-top:24px;font-size:24px;line-height:1.4;color:#c9cfe3;font-weight:500;width:540px">${variant.body}</div>
    </div>
    <div style="position:absolute;left:72px;bottom:56px;display:inline-flex;align-items:center;gap:12px;padding:10px 20px;border-radius:999px;border:1px solid rgba(34,211,238,.5);background:rgba(6,9,19,.55);color:#22d3ee;font-weight:800;letter-spacing:.14em;font-size:16px;text-transform:uppercase"><span style="width:9px;height:9px;border-radius:50%;background:#22d3ee"></span>${variant.badge}</div>
  </body></html>`
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
const scene = await captureScene(browser)
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
mkdirSync(outDir, { recursive: true })
for (const [name, variant] of Object.entries(VARIANTS)) {
  await page.setContent(html(scene, variant), { waitUntil: 'networkidle' })
  const png = await page.screenshot({ type: 'png' })
  writeFileSync(resolve(outDir, `${name}.png`), png)
  console.log(`og/${name}.png ${Math.round(png.length / 1024)} KB`)
}
await browser.close()
