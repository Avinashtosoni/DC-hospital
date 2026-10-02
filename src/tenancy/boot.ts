import { supabase, tenancyMode } from '../lib/supabase'
import { enableTenancy, setSiteTenant, slugHint, type TenantInfo } from './state'
import { DEMO_TENANTS, demoTenantBySlug } from './demo'

export type BootResult =
  | { ok: true; tenant: TenantInfo | null }
  | { ok: false; reason: 'not_found' | 'suspended' | 'error'; tenant?: TenantInfo; message?: string }

/**
 * Runs once before the app renders. Single-hospital installs and demo mode skip it entirely.
 * Multi mode: the domain (or `?hospital=slug` on unmapped hosts) picks the hospital.
 */
export async function bootTenancy(host = location.hostname): Promise<BootResult> {
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
