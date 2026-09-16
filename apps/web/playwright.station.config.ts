import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests', testMatch: 'station.spec.ts', timeout: 120_000, workers: 1, reporter: 'list',
  outputDir: '/tmp/nim-relay-production/playwright',
  use: { baseURL: 'http://127.0.0.1:5176', viewport: { width: 430, height: 900 }, deviceScaleFactor: 1,
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] } },
  webServer: { command: 'pnpm dev --host 127.0.0.1 --port 5176', url: 'http://127.0.0.1:5176', reuseExistingServer: true },
})
