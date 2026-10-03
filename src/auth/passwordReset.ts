/**
 * "Forgot password → Use mobile": a 6-digit code on WhatsApp / SMS, then a new password.
 * Supabase: request_password_otp / verify_password_otp / reset_password_with_otp (scripts/sql/auth.sql).
 */
import { supabase } from '../lib/supabase'
import { flushNotificationsSoon } from '../settings/store'

export type OtpChannel = 'whatsapp' | 'sms'
export interface MobileOtpSent { channels: OtpChannel[]; expiresIn: number }
export class ResetError extends Error {
  constructor(message: string, public code: 'OFF' | 'OTP_REQUIRED' | 'OTHER' = 'OTHER') { super(message) }
}

export const phone10 = (p: string) => p.replace(/\D/g, '').slice(-10)
export const validMobile = (p: string) => /^[6-9]\d{9}$/.test(phone10(p))
export const validEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim())

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase!.rpc(fn, args)
  if (error) {
    const m = error.message
    if (m.startsWith('MOBILE_RESET_OFF')) throw new ResetError(m.replace(/^MOBILE_RESET_OFF:\s*/, ''), 'OFF')
    if (m.startsWith('OTP_REQUIRED')) throw new ResetError(m.replace(/^OTP_REQUIRED:\s*/, ''), 'OTP_REQUIRED')
    throw new ResetError(/fetch|network/i.test(m) ? 'Network problem — please check your connection and try again.' : m)
  }
  return data as T
}

// ------------------------------------------------------------------ Supabase
const remote = {
  channels: async () => ((await rpc<OtpChannel[] | null>('password_otp_channels', {})) ?? []),
  async request(email: string, phone: string, channel: OtpChannel): Promise<MobileOtpSent> {
    const r = await rpc<{ ref: string; channels: OtpChannel[]; expires_in: number }>('request_password_otp', { p_email: email.trim(), p_phone: phone, p_channel: channel })
    flushNotificationsSoon(0, [r.ref]) // deliver right away instead of waiting for the next cron run
    return { channels: r.channels ?? [channel], expiresIn: r.expires_in ?? 600 }
  },
  async verify(email: string, phone: string, code: string): Promise<string> {
    const r = await rpc<{ ok: boolean; token?: string; error?: string }>('verify_password_otp', { p_email: email.trim(), p_phone: phone, p_code: code })
    if (!r.ok || !r.token) throw new ResetError(r.error ?? 'That code is not correct.')
    return r.token
  },
  async reset(token: string, password: string): Promise<void> {
    await rpc('reset_password_with_otp', { p_token: token, p_password: password })
  },
}

export const mobileReset = remote
