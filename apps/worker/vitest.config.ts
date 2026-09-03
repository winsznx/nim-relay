import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// Cloudflare replaced @cloudflare/vitest-pool-workers's config-based setup
// with a plugin-based one (@cloudflare/vitest-plugin) alongside Vitest v4 -
// found empirically after the old defineWorkersConfig()/"./config" export
// disappeared; confirmed against current docs before locking this shape.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // Deterministic test bindings. The Supabase pair is forced empty so a
      // local .dev.vars (used for `wrangler dev` against the live project)
      // can't pull unit tests onto the network - tests always run the
      // in-memory AuthStore. The rest are the HMAC/origin values the auth
      // routes need, which live in secrets / .dev.vars outside tests.
      miniflare: {
        bindings: {
          SUPABASE_URL: '',
          SUPABASE_SERVICE_ROLE_KEY: '',
          SESSION_SECRET: 'test-session-secret',
          DEVICE_HASH_SECRET: 'test-device-hash-secret',
          RUN_CHALLENGE_SECRET: 'test-run-challenge-secret',
          APP_ORIGIN: 'http://localhost:5173',
        },
      },
    }),
  ],
})
