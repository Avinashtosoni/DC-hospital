import { supabase } from '../lib/supabase'
import { BILLING_DEFAULTS } from './billing'

export interface Lead {
  name: string
  organisation: string
  phone: string
  email: string
  city: string
  plan: string
  message: string
}


/** "Talk to us" form on the product page → `platform_leads` (visible to Hospital Comrade admins only). */
export async function submitLead(l: Lead): Promise<void> {
  if (supabase) {
    const { error } = await supabase.rpc('submit_platform_lead', {
      p_name: l.name, p_organisation: l.organisation, p_phone: l.phone, p_email: l.email,
      p_city: l.city, p_plan: l.plan, p_message: l.message, p_source: location.host,
    })
    if (error) throw new Error(error.message)
    return
  }
  throw new Error('The service is not connected yet — please e-mail or call us instead.')
}

/** same checks as the database, so people get instant feedback */
export function leadProblem(l: Lead): string | null {
  if (l.name.trim().length < 2) return 'Please enter your name.'
  if (l.organisation.trim().length < 2) return 'Please enter your hospital or clinic name.'
  const digits = l.phone.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 13) return 'Please enter a valid mobile number.'
  if (l.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email.trim())) return 'Please enter a valid email or leave it empty.'
  if (l.message.length > 2000) return 'Message is too long.'
  return null
}

// ------------------------------------------------------------------ self-service free trial (phase 8.2)
export type OtpChannel = 'whatsapp' | 'sms'
/** Control Panel → Sign-ups → Mobile verification */
export interface SignupOtpInfo { required: boolean; channels: OtpChannel[] }
export interface SignupInfo { enabled: boolean; mode: 'instant' | 'approve'; trialDays: number; plan: string; plans: string[]; otp?: SignupOtpInfo }
export interface SignupOtpSent { ref: string; channel: OtpChannel; to: string; expires_in: number; resend_in: number }
export interface SignupForm { organisation: string; name: string; email: string; phone: string; city: string; plan: string; website: string }
export type SignupResult = { status: 'created'; slug: string; email: string; trial_days: number } | { status: 'pending'; email: string }


/** is sign-up open, instant or reviewed, how many free days (platform admin's settings) */
export async function signupInfo(): Promise<SignupInfo> {
  if (!supabase) return { enabled: false, mode: 'approve', trialDays: BILLING_DEFAULTS.trialDays, plan: 'clinic', plans: [] }
  const { data, error } = await supabase.rpc('platform_signup_info')
  if (error) throw new Error(error.message)
  return data as SignupInfo
}

/** a 6-digit code to the mobile number on the platform's WhatsApp / SMS account; sent at once by the ops function */
export async function requestSignupOtp(phone: string, channel?: OtpChannel): Promise<SignupOtpSent> {
  if (!supabase) throw new Error('Verification is not available right now — please try again later.')
  const { data, error } = await supabase.rpc('request_signup_otp', { p_phone: phone, p_channel: channel ?? null })
  if (error) throw new Error(error.message)
  const sent = data as SignupOtpSent
  // the minute flush is the safety net — only an explicit "could not send" is shown
  const d = await supabase.functions.invoke('ops', { body: { deliver_signup_otp: sent.ref } }).then((r) => r.data as { ok?: boolean; message?: string } | null, () => null)
  if (d && d.ok === false && d.message) throw new Error(d.message)
  return sent
}

/** right code → a one-time token for trialSignup() */
export async function verifySignupOtp(phone: string, code: string): Promise<string> {
  if (!supabase) throw new Error('Verification is not available right now.')
  const { data, error } = await supabase.rpc('verify_signup_otp', { p_phone: phone, p_code: code })
  if (error) throw new Error(error.message)
  const r = data as { ok: boolean; token?: string; error?: string }
  if (!r.ok || !r.token) throw new Error(r.error ?? 'That code is not correct.')
  return r.token
}

export async function trialSignup(f: SignupForm, termsVersion: string, otpToken?: string | null): Promise<SignupResult> {
  if (supabase) {
    const { data, error } = await supabase.rpc('platform_trial_signup', { p: { ...f, terms_version: termsVersion, otp_token: otpToken ?? null } })
    if (error) throw new Error(error.message)
    return data as SignupResult
  }
  throw new Error('Sign-up is not available right now — please try again later.')
}

/** same checks as platform_trial_signup() */
export function signupProblem(f: SignupForm, agreed: boolean): string | null {
  if (f.organisation.trim().length < 2) return 'Please enter your hospital or clinic name.'
  if (f.name.trim().length < 2) return 'Please enter your name.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) return 'Please enter a valid e-mail — you will sign in with it.'
  if (!/^[6-9]\d{9}$/.test(f.phone.replace(/\D/g, '').slice(-10))) return 'Please enter a 10-digit Indian mobile number.'
  if (!agreed) return 'Please accept the Terms of Service and the Data Processing Agreement.'
  return null
}
