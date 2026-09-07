import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests', testMatch: 'relay-race.spec.ts', timeout: 100_000, workers: 1, reporter: 'list',
  outputDir: '/tmp/nim-relay-build/pw-race',
  use: { baseURL: 'http://127.0.0.1:5175', viewport: { width: 430, height: 900 }, deviceScaleFactor: 2,
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] } },
  webServer: { command: 'pnpm dev --host 127.0.0.1 --port 5175', url: 'http://127.0.0.1:5175/lab/relay-race-v3', reuseExistingServer: true, timeout: 45_000 },
})
