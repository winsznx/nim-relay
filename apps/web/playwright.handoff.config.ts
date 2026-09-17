import { defineConfig } from '@playwright/test'

// The handoff over the live finish scene (src/features/handoff/dev/handoff-lab.html) against mocked relay API
// responses and a stubbed Nimiq Pay; no local Worker is needed.
const local = 'http://127.0.0.1:5194'

export default defineConfig({
  testDir: './tests',
  testMatch: 'handoff.spec.ts',
  timeout: 150_000,
  workers: 1,
  reporter: 'list',
  outputDir: '/tmp/nim-relay-finish/playwright',
  use: {
    baseURL: local,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] },
  },
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5194 --strictPort', url: local, reuseExistingServer: true, timeout: 60_000 },
})
