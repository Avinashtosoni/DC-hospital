/**
 * "Sign in as user" (control panel → Users → Sign in as). The panel opens the hospital app in a new tab with
 *   /?hospital=<slug>#imp=<base64url JSON { id, token_hash, full_name, email, role, hospital, expires_at }>
 * This tab signs in with the one-time token, binds its session to the impersonation record (impersonation_bind) and
 * keeps everything in sessionStorage (src/lib/supabase.ts) — other tabs, including the admin's own, are untouched.
 * Ending it (banner button, sign-out, 30-minute limit) deletes the session on the server.
 */
import { IMPERSONATION_KEY, impersonationTab, supabase } from '../lib/supabase'

export interface ImpersonationSession {
  id: string
  full_name: string
  email: string
  role: string
  hospital: string
  expires_at: string
  admin_name?: string | null
  reason?: string | null
}

export const IMPERSONATION_BLOCKED = 'Not available while signed in as this user from the control panel.'

/** the hand-off the control panel puts after #imp= */
export function encodeImpersonation(p: ImpersonationSession & { token_hash: string }) {
  const bytes = new TextEncoder().encode(JSON.stringify(p))
  let bin = ''
  bytes.forEach((b) => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function decodeImpersonation(s: string): (ImpersonationSession & { token_hash: string }) | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
    const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
    return p && typeof p.id === 'string' && typeof p.token_hash === 'string' ? p : null
  } catch { return null }
}

export function currentImpersonation(): ImpersonationSession | null {
  if (!impersonationTab) return null
  try {
    const v = sessionStorage.getItem(IMPERSONATION_KEY)
    return v ? (JSON.parse(v) as ImpersonationSession) : null
  } catch { return null }
}

/**
 * Before the app renders: a #imp= hand-off → sign in as that user in this tab. Returns an error message to show,
 * or null when there was nothing to do / it worked.
 */
export async function startImpersonationFromUrl(): Promise<string | null> {
  const m = window.location.hash.match(/^#imp=([A-Za-z0-9_-]+)$/)
  if (!m || !supabase) return null
  history.replaceState(null, '', window.location.pathname + window.location.search)   // the token never stays in the address bar
  const p = decodeImpersonation(m[1])
  if (!p) return 'This sign-in link is damaged. Start again from the control panel.'
  const { error } = await supabase.auth.verifyOtp({ token_hash: p.token_hash, type: 'email' })
  if (error) return `The sign-in link did not work (${error.message}). Start again from the control panel.`
  const { data, error: bindError } = await supabase.rpc('impersonation_bind', { p_id: p.id })
  if (bindError) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    return bindError.message
  }
  const { token_hash: _t, ...info } = p
  const bound = (data ?? {}) as { expires_at?: string; admin_name?: string; reason?: string }
  sessionStorage.setItem(IMPERSONATION_KEY, JSON.stringify({ ...info, ...bound } satisfies ImpersonationSession))
  return null
}

/** is the server still treating this tab as a running impersonation? (ended elsewhere / expired → false) */
export async function impersonationActive(id: string): Promise<boolean> {
  if (!supabase) return false
  const { data, error } = await supabase.rpc('impersonation_status', { p_id: id })
  if (error) return !/JWT|session|not authenticated/i.test(error.message)   // a network blip is not the end
  return !!(data as { active?: boolean } | null)?.active
}

/** end it: delete the session on the server, sign this tab out (local only), forget it */
export async function endImpersonation(reason = 'ended') {
  const s = currentImpersonation()
  if (supabase) {
    if (s) await supabase.rpc('impersonation_end', { p_id: s.id, p_reason: reason }).then(() => undefined, () => undefined)
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
  }
  try { sessionStorage.removeItem(IMPERSONATION_KEY); sessionStorage.setItem(`${IMPERSONATION_KEY}:ended`, reason) } catch { /* private mode */ }
}
