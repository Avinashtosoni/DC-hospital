import { createClient, type SupabaseClient } from '@supabase/supabase-js'

declare global {
  interface Window {
    /** Runtime config injected by the Docker container (docker/40-runtime-env.sh → /env.js) */
    __ENV__?: Partial<Record<'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY' | 'REQUIRE_BACKEND', string>>
  }
}

// Runtime values (Docker / Coolify env vars) win over build-time values (.env / build args).
const runtime = typeof window !== 'undefined' ? window.__ENV__ ?? {} : {}
const url = (runtime.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL) as string | undefined
const key = (runtime.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined

export const isSupabaseConfigured = Boolean(url && key)
/** Production installs set REQUIRE_BACKEND=true so a missing Supabase config stops the app instead of silently
 *  falling back to demo mode (where data lives only in each browser). */
export const backendMissing = !isSupabaseConfigured
  && /^(1|true|yes)$/i.test(String(runtime.REQUIRE_BACKEND || import.meta.env.VITE_REQUIRE_BACKEND || ''))
/** Project URL (for showing Edge Function webhook addresses in Settings). */
export const supabaseUrl = isSupabaseConfigured ? url! : ''

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true } })
  : null
