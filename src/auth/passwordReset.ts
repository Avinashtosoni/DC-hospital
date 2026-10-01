/**
 * "Forgot password → Use mobile": a 6-digit code on WhatsApp / SMS, then a new password.
 * Supabase: request_password_otp / verify_password_otp / reset_password_with_otp (scripts/sql/auth.sql).
 * Demo mode: simulated with the browser store; the code is shown on screen.
 */
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { localFindByEmailPhone, localSetPassword } from '../data/localAdapter'
import { flushNotificationsSoon } from '../settings/store'

export type OtpChannel = 'whatsapp' | 'sms'
export interface MobileOtpSent { channels: OtpChannel[]; expiresIn: number; /** demo mode only */ demoCode?: string | null }
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

// ------------------------------------------------------------------ demo mode
const KEY = 'dch:demo-pw-otp'
interface LocalOtp { email: string; phone: string; profile: string | null; code: string; expires: number; attempts: number; sentAt: number; token?: string; verifiedAt?: number }
const read = (): LocalOtp | null => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? 'null') } catch { return null } }
const write = (o: LocalOtp) => sessionStorage.setItem(KEY, JSON.stringify(o))
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const local = {
  async channels(): Promise<OtpChannel[]> { return ['whatsapp', 'sms'] },
  async request(email: string, phone: string, channel: OtpChannel): Promise<MobileOtpSent> {
    await wait(500)
    const prev = read(), p = phone10(phone)
    if (prev?.phone === p && Date.now() - prev.sentAt < 30e3) throw new ResetError('Please wait 30 seconds before requesting another code.')
    const profile = localFindByEmailPhone(email, p)
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, '0')
    write({ email: email.trim().toLowerCase(), phone: p, profile, code, expires: Date.now() + 600e3, attempts: 0, sentAt: Date.now() })
    return { channels: [channel], expiresIn: 600, demoCode: profile ? code : null }
  },
  async verify(email: string, phone: string, code: string): Promise<string> {
    await wait(400)
    const o = read()
    if (!o || o.phone !== phone10(phone) || o.expires < Date.now()) throw new ResetError('This code has expired. Please request a new one.')
    if (o.attempts >= 5) throw new ResetError('Too many wrong attempts. Please request a new code.')
    if (!o.profile || o.email !== email.trim().toLowerCase() || o.code !== code) {
      o.attempts++; write(o)
      const left = 5 - o.attempts
      throw new ResetError(left <= 0 ? 'Too many wrong attempts. Please request a new code.' : `That code is not correct — ${left} attempt${left === 1 ? '' : 's'} left.`)
    }
    o.token = crypto.randomUUID(); o.verifiedAt = Date.now(); o.expires = 0; write(o)
    return o.token
  },
  async reset(token: string, password: string): Promise<void> {
    await wait(400)
    const o = read()
    if (!o?.token || o.token !== token || !o.profile || Date.now() - (o.verifiedAt ?? 0) > 15 * 60e3) throw new ResetError('This reset has expired. Please verify your mobile number again.', 'OTP_REQUIRED')
    localSetPassword(o.profile, password)
    sessionStorage.removeItem(KEY)
  },
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

export const mobileReset = isSupabaseConfigured ? remote : local
export const isDemoAuth = !isSupabaseConfigured
