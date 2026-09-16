/**
 * Ports and paths owned by the lifecycle E2E. Nothing here overlaps the default
 * local stack (Vite on :5173, `wrangler dev` on :8787), which may be running.
 */

export const APP_PORT = 5180
export const WORKER_PORT = 8791
export const RPC_PORT = 8792

export const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`
export const WORKER_ORIGIN = `http://127.0.0.1:${WORKER_PORT}`
export const RPC_ORIGIN = `http://127.0.0.1:${RPC_PORT}`

export const E2E_ROOT = '/tmp/nim-relay-e2e'
export const STATE_DIR = `${E2E_ROOT}/state`
export const SHOTS_DIR = `${E2E_ROOT}/shots`
export const LOGS_DIR = `${E2E_ROOT}/logs`

export const VIEWPORT = { width: 390, height: 844 }
