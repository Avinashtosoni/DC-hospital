import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'
import type { Plugin } from 'vite'

/** Stamps a build id into dist/sw.js (so each deploy ships a new service worker) and writes dist/version.json. */
function pwaStamp(): Plugin {
  const id = process.env.SOURCE_COMMIT?.slice(0, 12) || Date.now().toString(36)
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

export default defineConfig({
  plugins: [react(), pwaStamp()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  build: {
    rollupOptions: {
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
