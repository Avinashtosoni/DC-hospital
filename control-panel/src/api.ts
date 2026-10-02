/**
 * Control panel data: the cp_* database functions (scripts/sql/control_panel.sql) — or, in demo mode (no database),
 * the browser store in ./demo.ts with the same rules.
 */
import { supabase } from '../../src/lib/supabase'
import { demoCp } from './demo'
import type {
  BillingAction, BillingConfig, CpAudit, CpHospital, CpHospitalDetail, CpLead, CpMe, CpMember, CpOverview, CpPayment,
  HospitalEdit, LeadStatus, MemberSave, NewHospital,
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
}

/** Postgres / PostgREST error → a sentence for people */
export function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)
  if (/JWT|not authenticated|refresh token/i.test(m)) return 'Your session has expired — please sign in again.'
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Could not reach the server. Check your connection and try again.'
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
}

export const isDemo = !supabase
export const cp: CpApi = supabase ? db : demoCp
