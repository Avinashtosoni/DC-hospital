// Sign-in OTP (scripts/sql/otp_verify.sql): status / request / verify for the signed-in session.
import { supabase } from '../lib/supabase'
import type { OtpChannelId, OtpStatus } from '../data/errors'

const client = () => { if (!supabase) throw new Error('No database'); return supabase }

/** null on an older database (no sign-in OTP there) or when signed out */
export async function loginOtpStatus(): Promise<OtpStatus | null> {
  const { data, error } = await client().rpc('login_otp_status')
  if (error) return null
  return (data ?? null) as OtpStatus | null
}

export interface OtpSent { sent: boolean; ref: string; scope: 'hospital' | 'team'; channel: OtpChannelId; to: string; expires_in: number }
export async function requestLoginOtp(channel: OtpChannelId | null): Promise<OtpSent> {
  const { data, error } = await client().rpc('request_login_otp', { p_channel: channel })
  if (error) throw new Error(error.message)
  return data as OtpSent
}

export async function verifyLoginOtp(code: string): Promise<void> {
  const { data, error } = await client().rpc('verify_login_otp', { p_code: code.replace(/\D/g, '') })
  if (error) throw new Error(error.message)
  const r = data as { ok: boolean; error?: string }
  if (!r.ok) throw new Error(r.error ?? 'That code is not right.')
}

/** the session id inside the current access token (Supabase puts it in the `session_id` claim) */
export async function currentSessionId(): Promise<string | null> {
  const { data } = await client().auth.getSession()
  return sessionIdOf(data.session?.access_token)
}
export function sessionIdOf(jwt?: string | null): string | null {
  try {
    const part = jwt?.split('.')[1]
    if (!part) return null
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')))
    return typeof json.session_id === 'string' ? json.session_id : null
  } catch { return null }
}

/** after a password re-check (which starts a new session), keep "this device entered its code" */
export async function carryLoginOtp(fromSession: string | null): Promise<void> {
  if (!fromSession) return
  await client().rpc('login_otp_carry', { p_from_session: fromSession }).then(() => undefined, () => undefined)
}

export const OTP_CHANNEL_LABEL: Record<OtpChannelId, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'E-mail' }
