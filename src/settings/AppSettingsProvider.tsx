import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthProvider'
import { deepMerge, useSiteSettings } from '../site/cms/content'
import { setFormatPrefs } from '../lib/utils'
import { DEFAULT_APP_SETTINGS, paletteFor, type AppSettings } from './types'
import type { SiteSettings } from '../site/cms/types'
import { isPrimaryTenant } from '../tenancy/state'
import { settingsStore, type SettingsRow } from './store'

export const APP_SETTINGS_QK = ['app-settings'] as const

/** Parts of an unsaved Settings draft that are previewed live across the whole dashboard. */
export type AppPreview = Pick<AppSettings, 'appearance' | 'modules' | 'announcement'>

interface Ctx {
  /** effective settings — includes the owner's unsaved appearance preview while Settings is open */
  settings: AppSettings
  /** exactly what is saved */
  savedSettings: AppSettings
  /** Settings page pushes its draft here (null = stop previewing) */
  setPreview: (p: AppPreview | null) => void
  row: SettingsRow | undefined
  loading: boolean
  save: (next: AppSettings) => Promise<void>
}
const AppSettingsCtx = createContext<Ctx | null>(null)

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const enabled = !!user
  const q = useQuery({ queryKey: APP_SETTINGS_QK, queryFn: settingsStore.load, enabled, staleTime: 5 * 60_000 })
  const savedSettings = useMemo(() => deepMerge(DEFAULT_APP_SETTINGS, q.data?.data ?? null), [q.data])
  const [preview, setPreview] = useState<AppPreview | null>(null)
  const settings = useMemo(() => (preview ? { ...savedSettings, ...preview } : savedSettings), [savedSettings, preview])

  // date/time formats are read synchronously by fmtDate/fmtTime
  setFormatPrefs({ date: settings.locale.dateFormat, time24: settings.locale.timeFormat === '24h' })

  // brand colours → CSS variables consumed by Tailwind's `brand-*` palette
  useEffect(() => {
    const pal = paletteFor(settings.appearance)
    const root = document.documentElement
    for (const [k, v] of Object.entries(pal)) root.style.setProperty(`--brand-${k}`, v)
    root.dataset.radius = settings.appearance.radius
  }, [settings.appearance])

  const save = useCallback(async (next: AppSettings) => {
    const row = await settingsStore.save(next)
    qc.setQueryData(APP_SETTINGS_QK, row)
  }, [qc])

  const value = useMemo(() => ({ settings, savedSettings, setPreview, row: q.data, loading: enabled && q.isPending, save }), [settings, savedSettings, q.data, q.isPending, enabled, save])
  return <AppSettingsCtx.Provider value={value}>{children}</AppSettingsCtx.Provider>
}

export function useAppSettings() {
  const c = useContext(AppSettingsCtx)
  if (!c) throw new Error('useAppSettings must be used inside AppSettingsProvider')
  return c
}

/** Favicon from Settings → Branding (falls back to the logo, then the bundled icon). */
const setMeta = (attr: 'name' | 'property', key: string, value: string) => {
  let m = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!m) { m = document.createElement('meta'); m.setAttribute(attr, key); document.head.appendChild(m) }
  m.content = value
}

/** The web-app manifest for THIS hospital (name, icon) — one static file can't serve every hospital's domain. */
export function hospitalManifest(s: Pick<SiteSettings, 'name' | 'brand' | 'seoDescription'>, origin: string) {
  const abs = (u: string) => new URL(u, origin).href
  const icons = [
    ...(s.brand?.logoUrl ? [{ src: abs(s.brand.logoUrl), sizes: 'any', purpose: 'any' }] : []),
    { src: abs('/icons/icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: abs('/icons/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: abs('/icons/maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ]
  const shortcut = (name: string, short_name: string, url: string) => ({ name, short_name, url: abs(url), icons: [{ src: abs('/icons/shortcut-book.png'), sizes: '96x96' }] })
  return {
    id: abs('/'), name: `${s.name} — Patient app`, short_name: (s.brand?.shortName || s.name).slice(0, 30),
    description: s.seoDescription || 'Book appointments, reschedule visits, download lab reports and bills.',
    start_url: abs('/?source=pwa'), scope: abs('/'), display: 'standalone', display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait-primary', background_color: '#f5f5ff', theme_color: '#292966', lang: 'en-IN', categories: ['health', 'medical'],
    icons,
    shortcuts: [shortcut('Book appointment', 'Book', '/book?source=pwa'), shortcut('My appointments', 'Visits', '/appointments?source=pwa'), shortcut('My lab reports', 'Reports', '/lab-tests?source=pwa')],
  }
}

/** Favicon, install name, link-preview tags and manifest follow the hospital's own brand (each hospital's domain). */
export function BrandEffects() {
  const s = useSiteSettings()
  const href = s.brand?.faviconUrl || s.brand?.logoUrl
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
    if (!link.dataset.default) link.dataset.default = link.href
    link.href = href || link.dataset.default
    const apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
    if (apple) { if (!apple.dataset.default) apple.dataset.default = apple.href; apple.href = s.brand?.logoUrl || apple.dataset.default }
  }, [href, s.brand?.logoUrl])
  const short = s.brand?.shortName || s.name
  useEffect(() => {
    setMeta('name', 'apple-mobile-web-app-title', short)
    setMeta('property', 'og:title', s.name)
    setMeta('property', 'og:site_name', s.name)
    if (s.seoDescription) setMeta('property', 'og:description', s.seoDescription)
  }, [s.name, short, s.seoDescription])
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    // the primary hospital keeps the real /manifest.webmanifest file; every other hospital gets its own
    if (!link || isPrimaryTenant() || typeof URL.createObjectURL !== 'function') return
    const url = URL.createObjectURL(new Blob([JSON.stringify(hospitalManifest(s, location.origin))], { type: 'application/manifest+json' }))
    link.href = url
    return () => URL.revokeObjectURL(url)
  }, [s.name, short, s.seoDescription, s.brand?.logoUrl]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/** Dashboard-only chrome: interface size + idle auto sign-out. Mounted by AppLayout. */
export function useDashboardChrome() {
  const { settings } = useAppSettings()
  const { user, signOut } = useAuth()
  const size = settings.appearance.size
  useEffect(() => {
    const root = document.documentElement
    root.dataset.appSize = size
    return () => { delete root.dataset.appSize }
  }, [size])

  const mins = settings.security.idleTimeoutMinutes
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    if (!user || !mins) return
    const reset = () => {
      clearTimeout(timer.current)
      timer.current = setTimeout(async () => {
        await signOut()
        toast.info('Signed out after inactivity', { description: `No activity for ${mins} minutes.` })
        window.location.assign('/login?reason=idle')
      }, mins * 60_000)
    }
    const evs = ['mousemove', 'keydown', 'pointerdown', 'scroll', 'touchstart'] as const
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => { clearTimeout(timer.current); evs.forEach((e) => window.removeEventListener(e, reset)) }
  }, [user, mins, signOut])
}
