import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests', testMatch: 'audio.spec.ts', timeout: 120_000, workers: 1, reporter: 'list',
  outputDir: '/tmp/nim-relay-production/playwright-audio',
  use: { baseURL: 'http://127.0.0.1:5179' },
  webServer: { command: 'pnpm dev --host 127.0.0.1 --port 5179', url: 'http://127.0.0.1:5179', reuseExistingServer: true },
})
