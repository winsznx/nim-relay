import { defineConfig } from '@playwright/test'

// The product tour against mocked Worker responses, on two phone sizes; no local Worker is needed.
const local = 'http://127.0.0.1:5193'
const phone = { deviceScaleFactor: 2, isMobile: true, hasTouch: true }

export default defineConfig({
  testDir: './tests',
  testMatch: 'tour.spec.ts',
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
  outputDir: '/tmp/nim-relay-tour/playwright',
  use: {
    baseURL: local,
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] },
  },
  projects: [
    { name: 'phone-390', use: { ...phone, viewport: { width: 390, height: 844 } } },
    { name: 'phone-430', use: { ...phone, viewport: { width: 430, height: 932 } } },
    // WebKit is the engine inside Nimiq Pay on iPhone.
    { name: 'iphone-webkit', use: { ...phone, browserName: 'webkit', viewport: { width: 390, height: 844 }, launchOptions: {} } },
  ],
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5193 --strictPort', url: local, reuseExistingServer: true, timeout: 60_000 },
})
