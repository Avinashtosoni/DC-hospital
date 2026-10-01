import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthProvider'
import { deepMerge, useSiteSettings } from '../site/cms/content'
import { setFormatPrefs } from '../lib/utils'
import { DEFAULT_APP_SETTINGS, paletteFor, type AppSettings } from './types'
import { setSettingsActor, settingsStore, type SettingsRow } from './store'

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
  const enabled = settingsStore.mode === 'local' || !!user
  const q = useQuery({ queryKey: APP_SETTINGS_QK, queryFn: settingsStore.load, enabled, staleTime: 5 * 60_000 })
  const savedSettings = useMemo(() => deepMerge(DEFAULT_APP_SETTINGS, q.data?.data ?? null), [q.data])
  const [preview, setPreview] = useState<AppPreview | null>(null)
  const settings = useMemo(() => (preview ? { ...savedSettings, ...preview } : savedSettings), [savedSettings, preview])
  useEffect(() => { if (user) setSettingsActor(user.full_name) }, [user])

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
export function BrandEffects() {
  const s = useSiteSettings()
  const href = s.brand?.faviconUrl || s.brand?.logoUrl
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
    if (!link.dataset.default) link.dataset.default = link.href
    link.href = href || link.dataset.default
  }, [href])
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
