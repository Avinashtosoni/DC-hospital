/**
 * Control panel data: the cp_* database functions (scripts/sql/control_panel.sql) — or, in demo mode (no database),
 * the browser store in ./demo.ts with the same rules.
 */
import { supabase } from '../../src/lib/supabase'
import { demoCp } from './demo'
import type {
  BillingAction, BillingConfig, CpAudit, CpHospital, CpHospitalDetail, CpLead, CpMe, CpMember, CpOverview, CpPayment,
  HospitalEdit, LeadStatus, MemberSave, NewHospital, CpHealth, CpIncident, IncidentSave, IncidentNotice, RetentionConfig,
  CpSignup, SignupSettings, LaunchReport,
} from './types'

export interface CpApi {
  signIn(email: string, password: string): Promise<CpMe>
  signOut(): Promise<void>
  me(): Promise<CpMe | null>
  overview(): Promise<CpOverview>
  hospitals(): Promise<CpHospital[]>
  hospital(id: string): Promise<CpHospitalDetail>
  createHospital(h: NewHospital): Promise<{ id: string; slug: string; domain: string | null; owner_email: string }>
  updateHospital(id: string, patch: HospitalEdit): Promise<CpHospital>
  billing(id: string, action: BillingAction, args: Record<string, unknown>): Promise<unknown>
  team(): Promise<CpMember[]>
  saveMember(m: MemberSave): Promise<void>
  leads(): Promise<CpLead[]>
  updateLead(id: string, patch: { status?: LeadStatus; notes?: string | null }): Promise<void>
  payments(tenantId?: string): Promise<CpPayment[]>
  audit(tenantId?: string): Promise<CpAudit[]>
  settings(): Promise<{ billing: BillingConfig }>
  saveBillingSettings(patch: Partial<BillingConfig>): Promise<BillingConfig>
  // phase 7 — offboarding, health, incidents, retention
  closeHospital(id: string, reason: string, days: number): Promise<unknown>
  reopenHospital(id: string): Promise<unknown>
  /** re-checks the signed-in admin's password first (the database wants a sign-in from the last 10 minutes) */
  purgeHospital(id: string, confirmSlug: string, password: string): Promise<{ purged: string; counts: Record<string, number> }>
  /** demo only: let the notice period run out so a purge can be tried */
  demoEndNotice?(id: string): Promise<void>
  health(): Promise<CpHealth>
  incidents(): Promise<CpIncident[]>
  saveIncident(p: IncidentSave): Promise<CpIncident>
  notifyIncident(id: string, message: string): Promise<IncidentNotice[]>
  retention(): Promise<RetentionConfig>
  saveRetention(p: Partial<RetentionConfig>): Promise<RetentionConfig>
  runRetention(): Promise<Record<string, number>>
  // phase 8.2 — self-service free-trial sign-ups
  signups(): Promise<CpSignup[]>
  decideSignup(id: string, action: 'approve' | 'reject', reason?: string): Promise<CpSignup>
  signupSettings(): Promise<SignupSettings>
  saveSignupSettings(p: Partial<SignupSettings>): Promise<SignupSettings>
  // phase 8.3
  launchCheck(): Promise<LaunchReport>
}

/** Postgres / PostgREST error → a sentence for people */
export function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)
  if (/JWT|not authenticated|refresh token/i.test(m)) return 'Your session has expired — please sign in again.'
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Could not reach the server. Check your connection and try again.'
  if (/REAUTH_REQUIRED/.test(m)) return 'Please confirm your password again — deleting a hospital needs a fresh sign-in.'
  return m.replace(/^(error:\s*)/i, '')
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase!.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

const db: CpApi = {
  async signIn(email, password) {
    const { error } = await supabase!.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    if (error) throw new Error(/invalid/i.test(error.message) ? 'Wrong e-mail or password.' : error.message)
    const me = await rpc<CpMe | null>('cp_me')
    if (!me) {
      await supabase!.auth.signOut()
      throw new Error('This account is not on the Hospital Comrade team. Hospital staff sign in on their hospital’s website.')
    }
    return me
  },
  async signOut() { await supabase!.auth.signOut() },
  async me() {
    const { data } = await supabase!.auth.getSession()
    if (!data.session) return null
    return rpc<CpMe | null>('cp_me')
  },
  overview: () => rpc('cp_overview'),
  hospitals: () => rpc('cp_hospitals'),
  hospital: (id) => rpc('cp_hospital', { p_id: id }),
  createHospital: (h) => rpc('cp_create_hospital', { p: h }),
  updateHospital: (id, patch) => rpc('cp_update_hospital', { p_id: id, p: patch }),
  billing: (id, action, args) => rpc('cp_billing', { p_id: id, p_action: action, p_args: args }),
  team: () => rpc('cp_team'),
  async saveMember(m) { await rpc('cp_save_provider', { p: m }) },
  async leads() {
    const { data, error } = await supabase!.from('platform_leads').select('*').order('created_at', { ascending: false }).limit(500)
    if (error) throw new Error(error.message)
    return data as CpLead[]
  },
  async updateLead(id, patch) {
    const { error } = await supabase!.from('platform_leads').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
  },
  payments: (tenantId) => rpc('cp_payments', { p_tenant: tenantId ?? null, p_limit: 500 }),
  audit: (tenantId) => rpc('cp_audit', { p_tenant: tenantId ?? null, p_limit: 500 }),
  settings: () => rpc('cp_settings'),
  saveBillingSettings: (patch) => rpc('cp_save_billing_settings', { p: patch }),
  closeHospital: (id, reason, days) => rpc('cp_close_hospital', { p_id: id, p_reason: reason, p_days: days }),
  reopenHospital: (id) => rpc('cp_reopen_hospital', { p_id: id }),
  async purgeHospital(id, confirmSlug, password) {
    const { data } = await supabase!.auth.getUser()
    const email = data.user?.email
    if (!email) throw new Error('Your session has expired — please sign in again.')
    // a fresh password sign-in puts a new "password" time in the token, which cp_purge_hospital checks
    const { error } = await supabase!.auth.signInWithPassword({ email, password })
    if (error) throw new Error(/invalid/i.test(error.message) ? 'Wrong password.' : error.message)
    return rpc('cp_purge_hospital', { p_id: id, p_confirm: confirmSlug })
  },
  health: () => rpc('cp_health'),
  incidents: () => rpc('cp_incidents'),
  saveIncident: (p) => rpc('cp_save_incident', { p }),
  notifyIncident: (id, message) => rpc('cp_notify_incident', { p_id: id, p_message: message }),
  retention: () => rpc('cp_retention'),
  saveRetention: (p) => rpc('cp_save_retention', { p }),
  runRetention: () => rpc('run_retention'),
  signups: () => rpc('cp_signups'),
  decideSignup: (id, action, reason) => rpc('cp_signup_decide', { p_id: id, p_action: action, p_reason: reason ?? null }),
  signupSettings: () => rpc('cp_signup_settings'),
  saveSignupSettings: (p) => rpc('cp_save_signup_settings', { p }),
  launchCheck: () => rpc('cp_launch_check'),
}

export const isDemo = !supabase
export const cp: CpApi = supabase ? db : demoCp
