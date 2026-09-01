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
    }),
  ],
})
