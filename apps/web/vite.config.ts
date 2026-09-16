import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Local dev: phone loads this over LAN, /api and /ws proxy to the local
// Wrangler Worker so the WebView sees the same same-origin shape production
// uses (PRD section 25.3 - avoids CORS drift between local and production).
const hmrHost = process.env.VITE_HMR_HOST

// Page navigations to shareable app routes get this dev server's app shell;
// other requests on those paths still reach the Worker, as in production.
const appPage = (req: { headers: { accept?: string | undefined } }) => (req.headers.accept?.includes('text/html') ? '/index.html' : undefined)

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    hmr: hmrHost ? { host: hmrHost, protocol: 'ws', clientPort: 5173 } : undefined,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/proof': { target: 'http://localhost:8787', changeOrigin: true, bypass: appPage },
      '/invite': { target: 'http://localhost:8787', changeOrigin: true, bypass: appPage },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
