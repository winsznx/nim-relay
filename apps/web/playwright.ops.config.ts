import { defineConfig } from '@playwright/test'

// The operator report against mocked Worker responses; no local Worker is needed.
const local = 'http://127.0.0.1:5192'

export default defineConfig({
  testDir: './tests',
  testMatch: 'ops.spec.ts',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  outputDir: '/tmp/nim-relay-ops/playwright',
  use: {
    baseURL: local,
    viewport: { width: 390, height: 844 },
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] },
  },
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5192 --strictPort', url: local, reuseExistingServer: true, timeout: 60_000 },
})
