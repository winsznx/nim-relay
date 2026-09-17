import { defineConfig } from '@playwright/test'

// Relay Grants against mocked Worker responses and a stubbed Nimiq Pay host; no local Worker is needed.
const local = 'http://127.0.0.1:5196'

export default defineConfig({
  testDir: './tests',
  testMatch: 'grants.spec.ts',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  outputDir: '/tmp/nim-relay-grants/playwright',
  use: {
    baseURL: local,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] },
  },
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5196 --strictPort', url: local, reuseExistingServer: true, timeout: 60_000 },
})
