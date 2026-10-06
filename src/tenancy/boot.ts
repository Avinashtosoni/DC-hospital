import { platformDomain, supabase, tenancyMode } from '../lib/supabase'
import { enableTenancy, forgetSlugHint, setSiteTenant, slugHint, type TenantInfo } from './state'
import { hostSlug } from './urls'

export type BootResult =
  | { ok: true; tenant: TenantInfo | null; platform?: false }
  /** the platform's own domain with no hospital picked → Hospital Comrade product page */
  | { ok: true; tenant: null; platform: true }
  | { ok: false; reason: 'not_found' | 'suspended' | 'error'; tenant?: TenantInfo; message?: string }

/**
 * Runs once before the app renders. Single-hospital installs skip it entirely.
 * Multi mode: the domain (or `?hospital=slug` on unmapped hosts) picks the hospital.
 */
/**
 * Is this the platform's own domain (PLATFORM_DOMAIN, with or without www.) with no hospital chosen?
 * - `?hospital=<slug>` opens a hospital there (with TENANT_SUBDOMAINS=on main.tsx sends it to <slug>.domain first);
 * - the bare `/` is always the product page — a slug remembered in this tab from an earlier link no longer
 *   turns it into a hospital (that was why `/` showed the product page in one tab and a hospital in another);
 * - other paths (`/login` …) of a hospital opened in this tab keep working on reload;
 * - `?platform` forces the product page on any host (previews).
 */
export function isPlatformLanding(host: string, search = typeof location === 'undefined' ? '' : location.search,
  path = typeof location === 'undefined' ? '/' : location.pathname): boolean {
  if (new URLSearchParams(search).has('platform')) return true
  const h = host.toLowerCase().split(':')[0].replace(/^www\./, '')
  if (!platformDomain || h !== platformDomain) return false
  const q = new URLSearchParams(search).get('hospital')
  if (q !== null && q.trim()) { slugHint(search); return false }
  if (q !== null || path === '/' || path === '') { forgetSlugHint(); return true }
  return !slugHint(search)
}

export async function bootTenancy(host = location.hostname): Promise<BootResult> {
  if (!supabase) return { ok: false, reason: 'error', message: 'The database is not connected.' }
  // the platform's own domain shows the product page (multi-hospital mode only; never a single-hospital install)
  if (tenancyMode === 'multi' && isPlatformLanding(host)) return { ok: true, tenant: null, platform: true }
  if (tenancyMode !== 'multi') { enableTenancy(false); return { ok: true, tenant: null } }
  enableTenancy(true)
  try {
    // city.hospital.digitalcomrade.in → city (a custom domain is matched by resolve_tenant itself)
    const { data, error } = await supabase.rpc('resolve_tenant', { p_host: host, p_slug: hostSlug(host) ?? slugHint() })
    if (error) throw error
    const t = (Array.isArray(data) ? data[0] : data) as TenantInfo | undefined
    if (!t) return { ok: false, reason: 'not_found' }
    setSiteTenant(t)
    if (t.status === 'suspended') return { ok: false, reason: 'suspended', tenant: t }
    return { ok: true, tenant: t }
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) }
  }
}
