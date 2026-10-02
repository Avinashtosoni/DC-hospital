/**
 * Which hospital this browser tab is working in (multi-hospital "Hospital Comrade" mode).
 *
 * - The website's domain decides the hospital (`resolve_tenant(host)`); every request then carries
 *   `x-tenant-id` so anonymous visitors (booking, forms, CMS) see that hospital only.
 * - Signed-in hospital users: the database ignores the header and uses their own hospital.
 * - Providers (Hospital Comrade team) pick a hospital with the switcher; admins also pick a mode
 *   (`x-provider-mode`). The choice lives in sessionStorage, so each tab can look at a different hospital.
 *
 * Plain module (no React, no Supabase import) so the Supabase fetch wrapper can read it without cycles.
 */

export type ProviderRole = 'admin' | 'support' | 'finance'
export type TenantStatus = 'trial' | 'active' | 'grace' | 'read_only' | 'suspended'

export interface TenantInfo {
  id: string
  slug: string
  name: string
  status: TenantStatus
  plan?: string | null
  modules?: Record<string, 'provider' | 'hospital'> | null
  is_primary?: boolean
}

/** what `my_context()` returns for the signed-in user */
export interface MyContext {
  tenant: TenantInfo | null
  role: string | null
  provider_role: ProviderRole | null
  provider_mode: ProviderRole | null
}

const KEY = 'dch:provider:v1'
const SLUG_KEY = 'dch:hospital:v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ProviderChoice { tenantId?: string | null; mode?: ProviderRole | null }

function storage(): Storage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage } catch { return null }
}
function readChoice(): ProviderChoice {
  try { return JSON.parse(storage()?.getItem(KEY) ?? '{}') as ProviderChoice } catch { return {} }
}
function writeChoice(c: ProviderChoice) {
  try { storage()?.setItem(KEY, JSON.stringify(c)) } catch { /* private mode: lasts until reload */ }
}

let enabled = false
let site: TenantInfo | null = null
let choice: ProviderChoice = {}

/** switch header sending on (multi mode with a database) */
export function enableTenancy(on = true) { enabled = on; choice = on ? readChoice() : {} }
export function tenancyEnabled() { return enabled }

/** the hospital this website (domain) belongs to */
export function setSiteTenant(t: TenantInfo | null) { site = t }
export function siteTenant() { return site }

/** fixed id of the primary hospital (the original single-hospital install) — same value as in tenancy_core.sql */
export const PRIMARY_TENANT_ID = 'a0000000-0000-4000-8000-000000000001'

/** provider's chosen hospital (falls back to the website's hospital) */
export function activeTenantId(): string | null {
  const id = choice.tenantId && UUID.test(choice.tenantId) ? choice.tenantId : null
  return id ?? site?.id ?? null
}
/** is the hospital this tab works in the primary one? (always true for single-hospital installs) */
export function isPrimaryTenant(): boolean {
  if (!enabled) return true
  const id = activeTenantId()
  if (!id) return true
  if (id === site?.id && site?.is_primary !== undefined) return !!site.is_primary
  return id === PRIMARY_TENANT_ID
}
export function providerChoice(): ProviderChoice { return { ...choice } }
export function chooseProviderTenant(tenantId: string | null) { choice = { ...choice, tenantId }; writeChoice(choice) }
export function chooseProviderMode(mode: ProviderRole | null) { choice = { ...choice, mode }; writeChoice(choice) }
export function clearProviderChoice() { choice = {}; try { storage()?.removeItem(KEY) } catch { /* ignore */ } }

/** headers added to every Supabase request */
export function tenantHeaders(): Record<string, string> {
  if (!enabled) return {}
  const h: Record<string, string> = {}
  const id = activeTenantId()
  if (id) h['x-tenant-id'] = id
  if (choice.mode) h['x-provider-mode'] = choice.mode
  return h
}

/** `?hospital=<slug>` picks a hospital on hosts that have no domain mapped yet (preview / local / staging) */
export function slugHint(search = typeof location === 'undefined' ? '' : location.search): string | null {
  const q = new URLSearchParams(search).get('hospital')
  const s = storage()
  if (q !== null) {
    const v = q.trim().toLowerCase()
    try { if (v) s?.setItem(SLUG_KEY, v); else s?.removeItem(SLUG_KEY) } catch { /* ignore */ }
    return v || null
  }
  try { return s?.getItem(SLUG_KEY) ?? null } catch { return null }
}

/**
 * A hospital account may only be used on its own hospital's website.
 * Returns an error message, or null when the context is fine.
 */
export function contextProblem(ctx: MyContext, siteT: TenantInfo | null): string | null {
  if (ctx.provider_role) return null
  if (!ctx.tenant) return 'This account is not linked to a hospital. Please contact the hospital.'
  if (siteT && ctx.tenant.id !== siteT.id) {
    return `This account belongs to ${ctx.tenant.name}. Please sign in on ${ctx.tenant.name}'s website.`
  }
  return null
}

export const PROVIDER_ROLE_LABEL: Record<ProviderRole, string> = { admin: 'Admin', support: 'Support', finance: 'Finance' }
