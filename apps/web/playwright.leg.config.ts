import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: 'leg.spec.ts',
  timeout: 300_000,
  workers: 1,
  reporter: 'list',
  outputDir: '/tmp/nim-relay-leg/playwright',
  use: {
    baseURL: 'http://127.0.0.1:5177',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] },
  },
  webServer: { command: 'pnpm dev --host 127.0.0.1 --port 5177', url: 'http://127.0.0.1:5177/dev/leg', reuseExistingServer: true, timeout: 120_000 },
})
