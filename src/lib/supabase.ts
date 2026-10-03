import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { tenantHeaders } from '../tenancy/state'

declare global {
  interface Window {
    /** Runtime config injected by the Docker container (docker/40-runtime-env.sh → /env.js) */
    __ENV__?: Partial<Record<'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY' | 'REQUIRE_BACKEND' | 'TENANCY' | 'APP_ENV' | 'PLATFORM_NAME' | 'PLATFORM_DOMAIN'
      | 'PLATFORM_LEGAL_NAME' | 'PLATFORM_ADDRESS' | 'PLATFORM_EMAIL' | 'PLATFORM_PHONE' | 'PLATFORM_GRIEVANCE_OFFICER' | 'PLATFORM_JURISDICTION' | 'SENTRY_DSN', string>>
  }
}

// Runtime values (Docker / Coolify env vars) win over build-time values (.env / build args).
const runtime = typeof window !== 'undefined' ? window.__ENV__ ?? {} : {}
const url = (runtime.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL) as string | undefined
const key = (runtime.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined

export const isSupabaseConfigured = Boolean(url && key)
/** There is no demo / in-browser mode: without the Supabase URL + anon key the app shows a setup screen and stops. */
export const backendMissing = !isSupabaseConfigured
/** single = one hospital per install · multi = Hospital Comrade SaaS (hospital picked by domain). */
export const tenancyMode: 'single' | 'multi' = String(runtime.TENANCY || import.meta.env.VITE_TENANCY || 'single').toLowerCase() === 'multi' ? 'multi' : 'single'
/** production | staging — staging shows a badge so nobody mistakes it for the live site. */
export const appEnv: 'production' | 'staging' = String(runtime.APP_ENV || import.meta.env.VITE_APP_ENV || 'production').toLowerCase() === 'staging' ? 'staging' : 'production'
/** SaaS brand + domain (configurable — the domain will change) */
export const platformName = String(runtime.PLATFORM_NAME || import.meta.env.VITE_PLATFORM_NAME || 'Hospital Comrade')
export const platformDomain = String(runtime.PLATFORM_DOMAIN || import.meta.env.VITE_PLATFORM_DOMAIN || 'hospital.digitalcomrade.in').toLowerCase()
/** the company behind the platform — printed on the legal pages (Terms, Privacy, Refunds, DPA, Contact) */
const envOr = (k: keyof NonNullable<Window['__ENV__']>, fallback: string) =>
  String(runtime[k] || (import.meta.env as Record<string, string | undefined>)[`VITE_${k}`] || fallback).trim()
export const platformCompany = {
  legalName: envOr('PLATFORM_LEGAL_NAME', 'Digital Comrade'),
  address: envOr('PLATFORM_ADDRESS', 'Purnia, Bihar, India'),
  email: envOr('PLATFORM_EMAIL', `support@${platformDomain.replace(/^[^.]+\.(?=[^.]+\.[^.]+$)/, '')}`),
  phone: envOr('PLATFORM_PHONE', ''),
  grievanceOfficer: envOr('PLATFORM_GRIEVANCE_OFFICER', ''),
  jurisdiction: envOr('PLATFORM_JURISDICTION', 'Purnia, Bihar'),
}
/** optional error reporting (phase 8) — empty = off */
export const sentryDsn = envOr('SENTRY_DSN', '')
/** Project URL (for showing Edge Function webhook addresses in Settings). */
export const supabaseUrl = isSupabaseConfigured ? url! : ''

/**
 * "Sign in as user" tab (opened by the control panel with #imp=…): its session lives in this tab's sessionStorage under
 * its own key, so it never touches the admin's own sign-in in other tabs (src/auth/impersonation.ts).
 */
export const IMPERSONATION_KEY = 'dch:imp'
export const impersonationTab = typeof window !== 'undefined' && (() => {
  try {
    return /^#imp=/.test(window.location.hash) || !!window.sessionStorage.getItem(IMPERSONATION_KEY)
      || !!window.sessionStorage.getItem(`${IMPERSONATION_KEY}:ended`)   // stays apart after it ended, even on reload
  } catch { return false }
})()

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, key!, {
    auth: impersonationTab
      ? { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: window.sessionStorage, storageKey: 'dch-impersonation-auth' }
      : { persistSession: true, autoRefreshToken: true },
    global: { fetch: tenantFetch },
  })
  : null

/** every request (REST, RPC, storage, Edge Functions) says which hospital it is for — multi mode only */
function tenantFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const extra = tenantHeaders()
  if (!Object.keys(extra).length) return fetch(input, init)
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
  for (const [k, v] of Object.entries(extra)) if (!headers.has(k)) headers.set(k, v)
  return fetch(input, { ...init, headers })
}
