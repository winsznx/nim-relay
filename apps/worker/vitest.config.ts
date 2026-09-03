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
      // Tests run the in-memory AuthStore, never the real database. Force the
      // Supabase bindings empty so a local .dev.vars (used for `wrangler dev`
      // against the live project) can't pull unit tests onto the network.
      miniflare: {
        bindings: { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
      },
    }),
  ],
})
