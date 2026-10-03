import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { AppSettingsProvider, BrandEffects } from './settings/AppSettingsProvider'
import { I18nProvider } from './i18n'
import { PwaPrompt } from './pwa/PwaPrompt'
import { ErrorBoundary, RouteError, reloadForChunkError } from './components/ErrorBoundary'
import { appEnv, backendMissing } from './lib/supabase'
import { initMonitoring } from './lib/monitoring'
import { bootTenancy } from './tenancy/boot'
import { TenantScreen } from './tenancy/TenantScreens'
import './index.css'

// staging copies must never show up in search results
if (appEnv === 'staging') { const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex, nofollow'; document.head.appendChild(m) }

// optional error reporting (SENTRY_DSN) — nothing happens without it
initMonitoring('app')

// stale JS chunk after a deploy (lazy import or Vite preload) → reload once
window.addEventListener('vite:preloadError', (e) => { if (reloadForChunkError((e as Event & { payload?: unknown }).payload ?? 'Failed to fetch dynamically imported module')) e.preventDefault() })

// Hospital Comrade product page (platform domain) — its own small chunk, never loaded on hospital sites
const PlatformLanding = lazy(() => import('./platform/PlatformLanding'))

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
})

/** Everything under one splat route: <App/> keeps its <Routes>, and the data router enables useBlocker
 *  (unsaved-changes prompts on in-app navigation). */
function Root() {
  return (
    <I18nProvider>
      <AuthProvider>
        <AppSettingsProvider>
          <BrandEffects />
          <App />
          <PwaPrompt />
        </AppSettingsProvider>
        <Toaster richColors position="top-right" closeButton toastOptions={{ style: { fontFamily: 'Inter, sans-serif' } }} />
      </AuthProvider>
    </I18nProvider>
  )
}
const router = createBrowserRouter([{ path: '*', element: <ErrorBoundary full><Root /></ErrorBoundary>, errorElement: <RouteError /> }])

function SetupError() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <div className="max-w-lg rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Database not connected</h1>
        <p className="mt-2 text-sm text-slate-600">This installation requires a Supabase database, but <code>VITE_SUPABASE_URL</code> / <code>VITE_SUPABASE_ANON_KEY</code> are not set.
          The administrator should add them to the server environment (Coolify → Environment Variables) and redeploy. See docs/SETUP_GUIDE.md.</p>
      </div>
    </div>
  )
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
// multi-hospital mode: find this domain's hospital first (a no-op for single-hospital installs)
;(backendMissing ? Promise.resolve(null) : bootTenancy()).then((boot) => {
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        {backendMissing ? <SetupError />
          : boot && !boot.ok ? <TenantScreen result={boot} />
          : boot?.platform ? <Suspense fallback={null}><PlatformLanding /></Suspense>
          : <RouterProvider router={router} />}
      </QueryClientProvider>
    </React.StrictMode>,
  )
})
