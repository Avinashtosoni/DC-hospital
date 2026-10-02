/**
 * Hospital Comrade control panel — a separate app (its own page and bundle) for the platform team:
 * hospitals, plans & billing, team, leads, payments, audit log and platform settings.
 * Served at /control-panel/ by the same container; it never loads the hospital app's code.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import '../../src/index.css'
import { App } from './App'
import { initMonitoring } from '../../src/lib/monitoring'

initMonitoring('control-panel')

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter basename="/control-panel">
        <App />
      </BrowserRouter>
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  </StrictMode>,
)
