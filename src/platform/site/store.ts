/**
 * Loads the product site's published content (platform_site()) once, merges it over the built-in defaults and
 * fills in the {tokens}. `?preview` shows unpublished drafts to a signed-in platform team member.
 */
import { useEffect, useState } from 'react'
import { platformCompany, platformDomain, platformName, supabase } from '../../lib/supabase'
import { defaultSite } from './defaults'
import type { LegalDocContent, PageKey, PlatformSite, Post, PostSummary } from './types'

export const isPreview = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('preview')

const TOKENS = (): Record<string, string> => ({
  platform: platformName, company: platformCompany.legalName, email: platformCompany.email, phone: platformCompany.phone,
  address: platformCompany.address, domain: platformDomain, grievance: platformCompany.grievanceOfficer || 'Grievance Officer',
})
/** "{platform} for {company}" → real values (unknown tokens are left as typed) */
export function fill(text: string, t = TOKENS()): string {
  return text.replace(/\{(platform|company|email|phone|address|domain|grievance)\}/g, (_, k: string) => t[k] ?? '')
}
function fillDeep<T>(v: T, t: Record<string, string>): T {
  if (typeof v === 'string') return fill(v, t) as T
  if (Array.isArray(v)) return v.map((x) => fillDeep(x, t)) as T
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillDeep(x, t)])) as T
  return v
}

/** saved legal docs replace the default with the same slug; new slugs are added; `hidden` ones are left out */
export function mergeLegal(defaults: LegalDocContent[], saved?: LegalDocContent[]): LegalDocContent[] {
  if (!Array.isArray(saved)) return defaults
  const bySlug = new Map(saved.filter((d) => d && typeof d.slug === 'string').map((d) => [d.slug, d]))
  const out = defaults.map((d) => ({ ...d, ...(bySlug.get(d.slug) ?? {}) }))
  for (const d of saved) if (d?.slug && !defaults.some((x) => x.slug === d.slug)) out.push(d)
  return out
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
/** saved values over defaults: objects field by field (so fields added in later versions appear), lists replaced whole */
export function deepMerge<T>(base: T, saved: unknown): T {
  if (!isObj(base) || !isObj(saved)) return (saved === undefined || saved === null || (Array.isArray(base) && !Array.isArray(saved)) ? base : saved) as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(saved)) out[k] = k in base ? deepMerge((base as Record<string, unknown>)[k], v) : v
  return out as T
}

/** published rows over the defaults (missing fields keep the default) */
export function mergeSite(rows: Partial<Record<PageKey, unknown>>, fillTokens = true): PlatformSite {
  const base = defaultSite()
  const out = { ...base } as Record<PageKey, unknown>
  for (const k of Object.keys(base) as PageKey[]) {
    const saved = rows[k]
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) continue
    out[k] = k === 'legal'
      ? { docs: mergeLegal(base.legal.docs, (saved as { docs?: LegalDocContent[] }).docs) }
      : deepMerge(base[k], saved)
  }
  return fillTokens ? fillDeep(out as unknown as PlatformSite, TOKENS()) : (out as unknown as PlatformSite)
}

// ------------------------------------------------------------------ loading (once per page view)
let cache: Promise<PlatformSite> | null = null
export function loadSite(): Promise<PlatformSite> {
  if (cache) return cache
  const fallback = () => mergeSite({})
  if (!supabase) return (cache = Promise.resolve(fallback()))
  const req = supabase.rpc('platform_site', { p_preview: isPreview() }).then(({ data, error }) => {
    if (error) throw error
    return mergeSite((data ?? {}) as Partial<Record<PageKey, unknown>>)
  })
  // never leave the page blank: defaults after 5 s or on any error (e.g. the database is being upgraded)
  const timeout = new Promise<PlatformSite>((r) => setTimeout(() => r(fallback()), 5000))
  cache = Promise.race([req, timeout]).catch(fallback)
  return cache
}

export function useSite(): PlatformSite | null {
  const [site, setSite] = useState<PlatformSite | null>(null)
  useEffect(() => { let on = true; loadSite().then((s) => on && setSite(s)); return () => { on = false } }, [])
  return site
}

// ------------------------------------------------------------------ blog
export async function fetchBlog(tag: string | null, offset = 0, limit = 12): Promise<{ total: number; tags: string[]; rows: PostSummary[] }> {
  if (!supabase) return { total: 0, tags: [], rows: [] }
  const { data, error } = await supabase.rpc('platform_blog', { p_tag: tag, p_offset: offset, p_limit: limit })
  if (error) throw new Error(error.message)
  return data as { total: number; tags: string[]; rows: PostSummary[] }
}
export async function fetchPost(slug: string): Promise<Post | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('platform_blog_post', { p_slug: slug, p_preview: isPreview() })
  if (error) throw new Error(error.message)
  return (data ?? null) as Post | null
}
