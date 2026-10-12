import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'
import type { Plugin } from 'vite'

/** Stamps a build id into dist/sw.js (so each deploy ships a new service worker) and writes dist/version.json. */
const BUILD_ID = process.env.SOURCE_COMMIT?.slice(0, 12) || Date.now().toString(36)
function pwaStamp(): Plugin {
  const id = BUILD_ID
  return {
    name: 'dch-pwa-stamp',
    apply: 'build',
    closeBundle() {
      const out = path.resolve(__dirname, 'dist')
      const sw = path.join(out, 'sw.js')
      if (fs.existsSync(sw)) fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace('__BUILD_ID__', id))
      fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({ build: id, builtAt: new Date().toISOString() }))
    },
  }
}

/** dev / preview: deep links inside the control panel (/control-panel/hospitals/…) get its page, not the hospital app's */
function controlPanelFallback(): Plugin {
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    const url = req.url ?? ''
    if (/^\/control-panel(\/|$)/.test(url) && !/\.[a-z0-9]+(\?|$)/i.test(url.split('?')[0]) && !url.startsWith('/control-panel/src/')) req.url = '/control-panel/index.html'
    next()
  }
  return {
    name: 'dch-control-panel-fallback',
    configureServer(server) { server.middlewares.use(rewrite) },
    configurePreviewServer(server) { server.middlewares.use(rewrite) },
  }
}

export default defineConfig({
  plugins: [react(), pwaStamp(), controlPanelFallback()],
  // the build id also tags error reports (src/lib/monitoring.ts)
  define: { __APP_BUILD__: JSON.stringify(BUILD_ID) },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  build: {
    rollupOptions: {
      // two pages: the hospital app (index.html) and the separate Hospital Comrade control panel (/control-panel/)
      input: { index: path.resolve(__dirname, 'index.html'), control: path.resolve(__dirname, 'control-panel/index.html') },
      output: {
        // recharts is NOT listed: as a manual chunk it would also swallow small shared deps (clsx, react-is…)
        // and get preloaded on every page. Left alone, it only ships with the lazy Reports / dashboard charts.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router', 'react-router-dom'],
          data: ['@tanstack/react-query', '@supabase/supabase-js', 'date-fns'],
        },
      },
    },
  },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
})
