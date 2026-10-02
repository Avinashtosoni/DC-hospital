import { platformDomain, supabase, tenancyMode } from '../lib/supabase'
import { enableTenancy, setSiteTenant, slugHint, type TenantInfo } from './state'
import { DEMO_TENANTS, demoTenantBySlug } from './demo'

export type BootResult =
  | { ok: true; tenant: TenantInfo | null; platform?: false }
  /** the platform's own domain with no hospital picked → Hospital Comrade product page */
  | { ok: true; tenant: null; platform: true }
  | { ok: false; reason: 'not_found' | 'suspended' | 'error'; tenant?: TenantInfo; message?: string }

/**
 * Runs once before the app renders. Single-hospital installs and demo mode skip it entirely.
 * Multi mode: the domain (or `?hospital=slug` on unmapped hosts) picks the hospital.
 */
/**
 * Is this the platform's own domain (PLATFORM_DOMAIN, with or without www.) with no hospital chosen?
 * `?hospital=<slug>` still opens a hospital there (that's how the demo hospitals are reached); `?platform` forces the
 * product page on any host (previews).
 */
export function isPlatformLanding(host: string, search = typeof location === 'undefined' ? '' : location.search): boolean {
  if (new URLSearchParams(search).has('platform')) return true
  if (slugHint(search)) return false
  const h = host.toLowerCase().replace(/^www\./, '')
  return !!platformDomain && h === platformDomain
}

export async function bootTenancy(host = location.hostname): Promise<BootResult> {
  // the platform's own domain shows the product page (demo mode and multi-hospital mode; never a single-hospital install)
  if ((!supabase || tenancyMode === 'multi') && isPlatformLanding(host)) return { ok: true, tenant: null, platform: true }
  // demo mode (no database): two demo hospitals in the browser — ?hospital=citycare opens the second one
  if (!supabase) {
    enableTenancy(true)
    const slug = slugHint()
    const t = slug ? demoTenantBySlug(slug) : DEMO_TENANTS[0]
    if (!t) return { ok: false, reason: 'not_found' }
    setSiteTenant(t)
    return { ok: true, tenant: t }
  }
  if (tenancyMode !== 'multi') { enableTenancy(false); return { ok: true, tenant: null } }
  enableTenancy(true)
  try {
    const { data, error } = await supabase.rpc('resolve_tenant', { p_host: host, p_slug: slugHint() })
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
