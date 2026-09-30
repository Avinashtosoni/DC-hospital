import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { AppSettingsProvider, BrandEffects } from './settings/AppSettingsProvider'
import { I18nProvider } from './i18n'
import { PwaPrompt } from './pwa/PwaPrompt'
import './index.css'

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
const router = createBrowserRouter([{ path: '*', element: <Root /> }])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </QueryClientProvider>
  </React.StrictMode>,
)
