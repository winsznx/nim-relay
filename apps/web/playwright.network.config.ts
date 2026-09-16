import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests', testMatch: 'network.spec.ts', timeout: 120000, workers: 1, reporter: 'list',
  use: { baseURL: process.env.RELAY_BROWSER_URL ?? 'http://127.0.0.1:8790', viewport: { width: 430, height: 900 },
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] } },
})
