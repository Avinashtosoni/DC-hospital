import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '../../lib/utils'
import { safeUrl } from '../../lib/safeUrl'
import { activeTenantId, isPrimaryTenant } from '../../tenancy/state'
import { baseContent } from './starter'
import { cms, type ContentRows } from './store'
import { CONTENT_KEYS, type ContentKey, type SiteContent, type SiteDoctor, type SiteSettings } from './types'

export const CONTENT_QK = ['site-content'] as const
/** offline/instant-load cache — one per hospital, so a provider switching hospitals never sees another one's site */
const cacheKey = () => `dch:site-cache:v1${isPrimaryTenant() ? '' : `@${activeTenantId()}`}`
export const PREVIEW_CHANNEL = 'dch-cms-preview'
export const PREVIEW_WINDOW = 'dch-cms-preview'

// ------------------------------------------------------------------ merging
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Saved values win; missing object keys fall back to defaults (so new fields added in code always have a value). */
export function deepMerge<T>(base: T, over: unknown): T {
  if (over === undefined || over === null) return base
  if (Array.isArray(base)) return (Array.isArray(over) ? over : base) as T
  if (isObj(base) && isObj(over)) {
    const out: Record<string, unknown> = { ...base }
    for (const k of Object.keys(over)) out[k] = k in base ? deepMerge((base as Record<string, unknown>)[k], over[k]) : over[k]
    return out as T
  }
  return (typeof over === typeof base ? over : base) as T
}

/** the built-in content this tab's hospital falls back to (DC Hospital's own site for the primary hospital, a neutral starter otherwise) */
export const defaultContent = (): SiteContent => baseContent(isPrimaryTenant())

export function mergeRows(rows: ContentRows | undefined, drafts: Partial<Record<ContentKey, unknown>> = {}, base: SiteContent = defaultContent()): SiteContent {
  const out = {} as Record<ContentKey, unknown>
  for (const k of CONTENT_KEYS) {
    const saved = k in drafts ? drafts[k] : rows?.[k]?.data
    out[k] = deepMerge(base[k], saved)
  }
  return out as unknown as SiteContent
}

/** Replace {phone}, {email}… tokens in every string, using the site settings. */
export function fillTokens<T>(value: T, tokens: Record<string, string>): T {
  if (typeof value === 'string') return value.replace(/\{(\w+)\}/g, (m, t) => tokens[t] ?? m) as T
  if (Array.isArray(value)) return value.map((v) => fillTokens(v, tokens)) as T
  if (isObj(value)) { const o: Record<string, unknown> = {}; for (const k in value) o[k] = fillTokens(value[k], tokens); return o as T }
  return value
}

/** Public view: hidden items removed, compare-table columns kept in sync with visible packages. */
export function toPublic(c: SiteContent): SiteContent {
  const visible = <T extends { hidden?: boolean }>(a: T[]) => a.filter((x) => !x.hidden)
  const s = c.settings
  const tokens = { name: s.name, phone: s.phone, appointments: s.appointmentsPhone, whatsapp: s.whatsapp, email: s.email, address: s.address }
  const services = visible(c.services)
  const keepCols = c.packages.items.map((p, i) => (p.hidden ? -1 : i)).filter((i) => i >= 0)
  const doctors = visible(c.doctors).map((d) => ({ ...d, dept: d.dept || c.services.find((x) => x.slug === d.service)?.name || 'General' }))
  // admin-typed URLs: only http(s)/tel/mailto (see src/lib/safeUrl.ts) — a bad one hides the link instead of running script
  const settings = {
    ...s,
    map: { embedUrl: safeUrl(s.map?.embedUrl, 'web'), directionsUrl: safeUrl(s.map?.directionsUrl, 'web') },
    socials: (s.socials ?? []).map((x) => ({ ...x, url: safeUrl(x.url, 'web') })),
    brand: { ...s.brand, logoUrl: safeUrl(s.brand?.logoUrl, 'image'), faviconUrl: safeUrl(s.brand?.faviconUrl, 'image') },
  }
  const pub: SiteContent = {
    ...c,
    settings,
    services,
    support: visible(c.support),
    doctors,
    testimonials: visible(c.testimonials),
    packages: {
      items: visible(c.packages.items),
      compare: c.packages.compare.map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r, cells: keepCols.map((i) => r.cells[i] ?? '') })) })),
    },
    faqs: c.faqs.map((g) => ({ ...g, items: g.items.filter((i) => i.q.trim()) })).filter((g) => g.items.length),
  }
  return fillTokens(pub, tokens)
}

// ------------------------------------------------------------------ data hooks
const readCache = (): ContentRows | undefined => { try { const v = localStorage.getItem(cacheKey()); return v ? JSON.parse(v) : undefined } catch { return undefined } }

/** Raw saved rows (what the CMS edits). Cached in localStorage so repeat visits render instantly. */
export function useContentRows(opts: { enabled?: boolean } = {}) {
  return useQuery({
    enabled: opts.enabled ?? true,
    queryKey: CONTENT_QK,
    queryFn: async () => {
      const rows = await cms.fetchAll()
      try { localStorage.setItem(cacheKey(), JSON.stringify(rows)) } catch { /* quota */ }
      return rows
    },
    placeholderData: readCache,
    staleTime: 60_000,
    retry: 1,
  })
}

// ------------------------------------------------------------------ provider
interface SiteCtx { content: SiteContent; preview: boolean }
const Ctx = createContext<SiteCtx | null>(null)

/** Inside the CMS preview iframe, drafts are streamed in from the editor over a BroadcastChannel. */
function usePreviewDrafts() {
  const preview = typeof window !== 'undefined' && window.name === PREVIEW_WINDOW
  const [drafts, setDrafts] = useState<Partial<Record<ContentKey, unknown>>>({})
  useEffect(() => {
    if (!preview || !('BroadcastChannel' in window)) return
    const ch = new BroadcastChannel(PREVIEW_CHANNEL)
    ch.onmessage = (e: MessageEvent<{ type: string; key?: ContentKey; data?: unknown; path?: string }>) => {
      const m = e.data
      if (m.type === 'draft' && m.key) setDrafts((d) => ({ ...d, [m.key!]: m.data }))
      if (m.type === 'clear' && m.key) setDrafts((d) => { const n = { ...d }; delete n[m.key!]; return n })
    }
    ch.postMessage({ type: 'ready' })
    return () => ch.close()
  }, [preview])
  return { preview, drafts }
}

export function SiteContentProvider({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const q = useContentRows()
  const { preview, drafts } = usePreviewDrafts()
  const content = useMemo(() => toPublic(mergeRows(q.data, drafts)), [q.data, drafts])
  // First visit with no cache: wait briefly for real content instead of flashing the defaults.
  if (q.isPending && !q.data) return <>{fallback}</>
  return <Ctx.Provider value={{ content, preview }}>{children}</Ctx.Provider>
}

export function useSite(): SiteContent {
  const c = useContext(Ctx)
  // Outside the provider (e.g. tests) fall back to defaults.
  return c?.content ?? toPublic(defaultContent())
}
export const useIsPreview = () => useContext(Ctx)?.preview ?? false

/** Live site settings anywhere — inside the public site (provider) or the dashboard (fetches the CMS rows). */
export function useSiteSettings(): SiteSettings {
  const c = useContext(Ctx)
  const q = useContentRows({ enabled: !c })
  return useMemo(() => c?.content.settings ?? mergeRows(q.data).settings, [c, q.data])
}

// ------------------------------------------------------------------ helpers used by pages
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`
export const waHref = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`

export function useContact() {
  const s = useSite().settings
  return { ...s, tel: telHref(s.phone), appointmentsTel: telHref(s.appointmentsPhone), wa: waHref(s.whatsapp), mailto: `mailto:${s.email}` }
}

/** Per-page <title> and meta description, suffixed with the hospital name. */
export function useSeo(title: string, description?: string) {
  const { settings } = useSite()
  useEffect(() => {
    document.title = `${title} · ${settings.name}`
    const desc = description || settings.seoDescription
    if (desc) {
      let m = document.querySelector<HTMLMetaElement>('meta[name="description"]')
      if (!m) { m = document.createElement('meta'); m.name = 'description'; document.head.appendChild(m) }
      m.content = desc
    }
  }, [title, description, settings.name, settings.seoDescription])
}

/** Renders text where *stars* mark highlighted words, e.g. "Care that is *personal*". */
export function Rich({ text, hl = 'text-gradient', className }: { text: string; hl?: string; className?: string }) {
  const parts = text.split(/(\*[^*]+\*)/g).filter(Boolean)
  return (
    <span className={className}>
      {parts.map((p, i) => (p.startsWith('*') && p.endsWith('*') && p.length > 2
        ? <span key={i} className={cn(hl)}>{p.slice(1, -1)}</span>
        : <span key={i}>{p}</span>))}
    </span>
  )
}
export const plain = (text: string) => text.replace(/\*/g, '')

// ------------------------------------------------------------------ doctor helpers
export const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** Human label for the next day this doctor consults, relative to today. */
export function nextAvailable(d: SiteDoctor, from = new Date()): string {
  if (d.onLeave) return 'On leave'
  for (let i = 0; i < 7; i++) {
    const dt = new Date(from); dt.setDate(from.getDate() + i)
    const dow = WEEK[(dt.getDay() + 6) % 7]
    if (d.days.includes(dow)) {
      if (i === 0) return 'Today'
      if (i === 1) return 'Tomorrow'
      return dt.toLocaleDateString('en-IN', { weekday: 'long' })
    }
  }
  return 'By appointment'
}

/** Doctors attached to a speciality (by service slug). */
export const doctorsForService = (doctors: SiteDoctor[], slug: string) => doctors.filter((d) => d.service === slug)
/** Unique department names, in list order. */
export const departmentsOf = (doctors: SiteDoctor[]) => Array.from(new Set(doctors.map((d) => d.dept)))

/** CMS lists a website form can use as its options (Contact topics, specialities) — in the site or the dashboard. */
export function useFormLists(): { topics: string[]; services: string[] } {
  const c = useContext(Ctx)
  const q = useContentRows({ enabled: !c })
  return useMemo(() => {
    const content = c?.content ?? toPublic(mergeRows(q.data))
    return { topics: content.contactPage.topics, services: content.services.map((s) => s.name) }
  }, [c, q.data])
}
