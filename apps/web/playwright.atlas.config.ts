import { defineConfig } from '@playwright/test'

// The Relay Atlas on a phone-sized viewport against mocked relay API responses; no local Worker is needed.
const local = 'http://127.0.0.1:5195'

export default defineConfig({
  testDir: './tests',
  testMatch: 'atlas.spec.ts',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  outputDir: '/tmp/nim-relay-atlas/playwright',
  use: {
    baseURL: local,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] },
  },
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5195 --strictPort', url: local, reuseExistingServer: true, timeout: 60_000 },
})
