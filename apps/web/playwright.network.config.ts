import { defineConfig } from '@playwright/test'

// Runs against the Vite dev server, which proxies /api and /ws to a local
// `wrangler dev` on :8787. Set RELAY_BROWSER_URL to test another deployment.
const external = process.env.RELAY_BROWSER_URL
const local = 'http://127.0.0.1:5191'

export default defineConfig({
  testDir: './tests',
  testMatch: 'network.spec.ts',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  outputDir: '/tmp/nim-relay-world/playwright',
  use: {
    baseURL: external ?? local,
    viewport: { width: 430, height: 900 },
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] },
  },
  ...(external ? {} : { webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5191 --strictPort', url: local, reuseExistingServer: true, timeout: 60_000 } }),
})
