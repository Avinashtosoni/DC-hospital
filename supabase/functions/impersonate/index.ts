// Supabase Edge Function: "sign in as user" for the Hospital Comrade control panel (admins only).
//
//   supabase functions deploy impersonate
//
// The control panel calls it with the admin's own token (signed in with their password in the last 10 minutes):
//
//   POST { user_id, reason, minutes? }   → { id, email, full_name, role, slug, hospital, expires_at, token_hash }
//
// impersonation_start() — run as the caller — checks everything (admin, fresh password, reason, staff account, not
// blocked / suspended), records the session and logs it. Only then is a one-time sign-in link made for that user;
// the panel opens the hospital app in a new tab, which signs in with token_hash, binds its session
// (impersonation_bind) and shows a banner. The session is deleted when the admin ends it or after 30 minutes.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/tenant.ts'

const cors = corsHeaders('POST, OPTIONS')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const env = (k: string) => (Deno.env.get(k) ?? '').trim()
const SUPABASE_URL = env('SUPABASE_URL')
const admin = createClient(SUPABASE_URL, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Sign in first.' }, 401)
  let body: any
  try { body = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
  const userId = String(body?.user_id ?? ''), reason = String(body?.reason ?? '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: 'Choose a user.' }, 400)

  const asCaller = createClient(SUPABASE_URL, env('SUPABASE_ANON_KEY'), { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } })
  const { data: start, error } = await asCaller.rpc('impersonation_start', { p_user: userId, p_reason: reason, p_minutes: Number(body?.minutes) || 30 })
  if (error) return json({ error: error.message }, /REAUTH_REQUIRED|team|42501/.test(error.message + (error as any).code) ? 403 : 400)

  const { data: link, error: e2 } = await admin.auth.admin.generateLink({ type: 'magiclink', email: start.email })
  const token_hash = (link as any)?.properties?.hashed_token
  if (e2 || !token_hash) {
    await asCaller.rpc('impersonation_end', { p_id: start.id, p_reason: 'link_failed' })
    return json({ error: `Could not create the sign-in link: ${e2?.message ?? 'no token'}` }, 500)
  }
  return json({ ...start, token_hash })
})
