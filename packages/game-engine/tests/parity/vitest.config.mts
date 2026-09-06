import { fileURLToPath } from 'node:url'
import { cloudflareTest } from '../../../../apps/worker/node_modules/@cloudflare/vitest-plugin/dist/pool/index.mjs'
import { defineConfig } from 'vitest/config'

// An isolated, sourceless workerd test isolate: never loads the deployed Worker,
// Wrangler configuration, .dev.vars, or any application bindings.
export default defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  plugins: [cloudflareTest({
    miniflare: { compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'] },
  })],
  test: { include: ['src/replay/corpus.test.ts', 'src/relay-run/corpus.test.ts'] },
})
