import { platformDomain, supabase, tenancyMode } from '../lib/supabase'
import { enableTenancy, setSiteTenant, slugHint, type TenantInfo } from './state'

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
 * `?hospital=<slug>` still opens a hospital there; `?platform` forces the
 * product page on any host (previews).
 */
export function isPlatformLanding(host: string, search = typeof location === 'undefined' ? '' : location.search): boolean {
  if (new URLSearchParams(search).has('platform')) return true
  if (slugHint(search)) return false
  const h = host.toLowerCase().replace(/^www\./, '')
  return !!platformDomain && h === platformDomain
}

export async function bootTenancy(host = location.hostname): Promise<BootResult> {
  if (!supabase) return { ok: false, reason: 'error', message: 'The database is not connected.' }
  // the platform's own domain shows the product page (multi-hospital mode only; never a single-hospital install)
  if (tenancyMode === 'multi' && isPlatformLanding(host)) return { ok: true, tenant: null, platform: true }
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
