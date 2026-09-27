import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          data: ['@tanstack/react-query', '@supabase/supabase-js', 'date-fns'],
          charts: ['recharts'],
        },
      },
    },
  },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
})
