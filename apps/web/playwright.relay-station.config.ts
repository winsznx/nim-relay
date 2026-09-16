import { defineConfig } from '@playwright/test'

/** STATION_GL=gpu renders on the host GPU for faster local runs; the default SwiftShader matches CI. */
const glArgs = process.env.STATION_GL === 'gpu' ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] : ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']

export default defineConfig({
  testDir: './tests',
  testMatch: 'relay-station.spec.ts',
  timeout: 240_000,
  workers: 1,
  reporter: 'list',
  outputDir: '/tmp/nim-relay-station/playwright',
  use: {
    baseURL: 'http://127.0.0.1:5178',
    viewport: { width: 430, height: 900 },
    deviceScaleFactor: 2,
    launchOptions: { args: glArgs },
  },
  webServer: { command: 'pnpm dev --host 127.0.0.1 --port 5178', url: 'http://127.0.0.1:5178', reuseExistingServer: true, timeout: 60_000 },
})
