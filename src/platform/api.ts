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

const LOCAL_KEY = 'dch:platform-leads:v1'

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
  // demo mode: keep it in this browser so the flow can be tried end to end
  await new Promise((r) => setTimeout(r, 400))
  try {
    const all = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as unknown[]
    localStorage.setItem(LOCAL_KEY, JSON.stringify([{ ...l, created_at: new Date().toISOString() }, ...all].slice(0, 50)))
  } catch { /* storage full / private mode */ }
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
export interface SignupInfo { enabled: boolean; mode: 'instant' | 'approve'; trialDays: number; plan: string; plans: string[] }
export interface SignupForm { organisation: string; name: string; email: string; phone: string; city: string; plan: string; website: string }
export type SignupResult = { status: 'created'; slug: string; email: string; trial_days: number } | { status: 'pending'; email: string }

const DEMO_SIGNUP: SignupInfo = { enabled: true, mode: 'approve', trialDays: BILLING_DEFAULTS.trialDays, plan: 'clinic', plans: ['clinic', 'hospital', 'enterprise'] }
const SIGNUP_KEY = 'dch:platform-signups:v1'

/** is sign-up open, instant or reviewed, how many free days (platform admin's settings) */
export async function signupInfo(): Promise<SignupInfo> {
  if (!supabase) return DEMO_SIGNUP
  const { data, error } = await supabase.rpc('platform_signup_info')
  if (error) throw new Error(error.message)
  return data as SignupInfo
}

export async function trialSignup(f: SignupForm, termsVersion: string): Promise<SignupResult> {
  if (supabase) {
    const { data, error } = await supabase.rpc('platform_trial_signup', { p: { ...f, terms_version: termsVersion } })
    if (error) throw new Error(error.message)
    return data as SignupResult
  }
  // demo mode: nothing is created — the request is kept in this browser so the flow can be tried
  await new Promise((r) => setTimeout(r, 500))
  try {
    const all = JSON.parse(localStorage.getItem(SIGNUP_KEY) ?? '[]') as unknown[]
    localStorage.setItem(SIGNUP_KEY, JSON.stringify([{ ...f, terms_version: termsVersion, created_at: new Date().toISOString() }, ...all].slice(0, 20)))
  } catch { /* storage full / private mode */ }
  return { status: 'pending', email: f.email.trim().toLowerCase() }
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
