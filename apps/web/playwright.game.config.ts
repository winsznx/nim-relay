import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: 'game*.spec.ts',
  timeout: 75_000,
  workers: 1,
  reporter: 'list',
  outputDir: '/tmp/nim-relay-build/playwright',
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 1280, height: 900 } },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1',
    url: 'http://127.0.0.1:5173/play',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
