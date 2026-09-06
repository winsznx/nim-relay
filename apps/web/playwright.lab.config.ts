import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: 'relay-lab.spec.ts',
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
  outputDir: '/tmp/nim-relay-build/playwright-lab',
  use: { baseURL: 'http://127.0.0.1:5174', viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 5174',
    url: 'http://127.0.0.1:5174/lab/relay-run-v2',
    reuseExistingServer: true,
    timeout: 40_000,
  },
})
