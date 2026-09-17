import { defineConfig } from '@playwright/test'
import { APP_ORIGIN, APP_PORT, E2E_ROOT, LOGS_DIR, RPC_ORIGIN, RPC_PORT, STATE_DIR, TREASURY_TEST_KEY, VIEWPORT, WORKER_ORIGIN, WORKER_PORT } from './tests/lifecycle/env'

/**
 * The relay lifecycle end to end in real browsers, fully local: a mock Nimiq RPC
 * node, an isolated `wrangler dev` Worker with fresh state and no Supabase, and
 * Vite proxying to that Worker. No real wallet, NIM or public RPC is involved.
 *
 *   pnpm --filter @nim-relay/web exec playwright test -c playwright.lifecycle.config.ts
 */

const stopGracefully = { signal: 'SIGTERM', timeout: 10_000 } as const

export default defineConfig({
  testDir: './tests',
  testMatch: 'lifecycle.spec.ts',
  timeout: 12 * 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: `${E2E_ROOT}/playwright`,
  use: {
    baseURL: APP_ORIGIN,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    video: 'on',
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] },
  },
  webServer: [
    {
      name: 'mock-rpc',
      command: `mkdir -p ${LOGS_DIR} && exec node ../../scripts/e2e/mock-nimiq-rpc.mjs --port ${RPC_PORT} > ${LOGS_DIR}/mock-rpc.log 2>&1`,
      url: `${RPC_ORIGIN}/__health`,
      reuseExistingServer: false,
      gracefulShutdown: stopGracefully,
    },
    {
      name: 'worker',
      // Fresh Durable Object state every run. The empty Supabase variables override apps/worker/.dev.vars, so the
      // auth, run and archive stores stay in memory and nothing reaches the live database.
      command: [
        `rm -rf ${STATE_DIR} && mkdir -p ${LOGS_DIR} &&`,
        'exec pnpm --filter @nim-relay/worker exec wrangler dev',
        `--name nim-relay-e2e --ip 127.0.0.1 --port ${WORKER_PORT} --persist-to ${STATE_DIR}`,
        `--var NIMIQ_NETWORK:TestAlbatross --var NIMIQ_RPC_URL:${RPC_ORIGIN}/ --var APP_ORIGIN:${APP_ORIGIN}`,
        '--var SUPABASE_URL: --var SUPABASE_SERVICE_ROLE_KEY:',
        // Relay Grants on, signing with a key that only exists on the mock chain.
        `--var TREASURY_ENABLED:true --var TREASURY_PRIVATE_KEY:${TREASURY_TEST_KEY}`,
        `> ${LOGS_DIR}/worker.log 2>&1`,
      ].join(' '),
      env: { WRANGLER_SEND_METRICS: 'false' },
      url: `${WORKER_ORIGIN}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      gracefulShutdown: stopGracefully,
    },
    {
      name: 'web',
      command: `mkdir -p ${LOGS_DIR} && exec pnpm exec vite --host 127.0.0.1 --port ${APP_PORT} --strictPort > ${LOGS_DIR}/vite.log 2>&1`,
      env: { VITE_API_TARGET: WORKER_ORIGIN },
      url: APP_ORIGIN,
      timeout: 120_000,
      reuseExistingServer: false,
      gracefulShutdown: stopGracefully,
    },
  ],
})
