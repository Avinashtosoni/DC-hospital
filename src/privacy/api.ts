/**
 * Phase 7.1 — patients' privacy rights (DPDP Act): download my data, say no to health tips & offers, ask for a
 * correction or erasure; the owner answers on /privacy-requests. With a database: scripts/sql/compliance.sql
 * (my_data_export, set_marketing_consent, privacy_submit, privacy_resolve; privacy_requests is read-only to the
 * browser). Demo mode: the same rules in this browser (./demo.ts).
 */
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { demoPrivacy } from './demo'

export type PrivacyKind = 'access' | 'correction' | 'erasure'
export type PrivacyStatus = 'open' | 'done' | 'rejected'

export interface PrivacyRequest {
  id: string
  created_at: string
  profile_id: string | null
  patient_id: string | null
  requester_name: string | null
  kind: PrivacyKind
  details: string | null
  status: PrivacyStatus
  resolved_at: string | null
  resolved_by_name: string | null
  resolution: string | null
}

export interface MyPrivacy { marketing: boolean; requests: PrivacyRequest[] }

export const PRIVACY_QK = ['privacy'] as const
export const KIND_LABEL: Record<PrivacyKind, string> = { access: 'Copy of my data', correction: 'Correction', erasure: 'Erasure (delete)' }

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase!.rpc(fn, args)
  if (error) throw new Error(/does not exist|PGRST202/i.test(error.message) ? 'Privacy tools are not set up in the database yet — run supabase/upgrade-2026-10.sql.' : error.message)
  return data as T
}

export const privacyApi = {
  /** the signed-in patient: their choice + their requests */
  async mine(profileId: string): Promise<MyPrivacy> {
    if (!isSupabaseConfigured) return demoPrivacy.mine(profileId)
    const [p, r] = await Promise.all([
      supabase!.from('patients').select('marketing_opt_out').eq('profile_id', profileId).maybeSingle(),
      supabase!.from('privacy_requests').select('*').eq('profile_id', profileId).order('created_at', { ascending: false }).limit(50),
    ])
    if (r.error) throw new Error(r.error.message)
    return { marketing: !(p.data as { marketing_opt_out?: boolean } | null)?.marketing_opt_out, requests: (r.data ?? []) as PrivacyRequest[] }
  },

  /** everything the hospital holds about the signed-in patient (JSON); logged as a fulfilled access request */
  async exportMine(profileId: string): Promise<Record<string, unknown>> {
    if (!isSupabaseConfigured) return demoPrivacy.exportMine(profileId)
    return rpc('my_data_export')
  },

  async setMarketing(profileId: string, granted: boolean): Promise<void> {
    if (!isSupabaseConfigured) return demoPrivacy.setMarketing(profileId, granted)
    await rpc('set_marketing_consent', { p_granted: granted })
  },

  async submit(profileId: string, kind: 'correction' | 'erasure', details: string): Promise<void> {
    if (!isSupabaseConfigured) return demoPrivacy.submit(profileId, kind, details)
    await rpc('privacy_submit', { p_kind: kind, p_details: details || null })
  },

  /** owner: every request of the hospital, newest first */
  async list(status: PrivacyStatus | 'all'): Promise<PrivacyRequest[]> {
    if (!isSupabaseConfigured) return demoPrivacy.list(status)
    let q = supabase!.from('privacy_requests').select('*').order('created_at', { ascending: false }).limit(500)
    if (status !== 'all') q = q.eq('status', status)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data ?? []) as PrivacyRequest[]
  },

  /** owner: answer a request; marking an erasure "done" anonymises the patient and deletes their login */
  async resolve(id: string, status: 'done' | 'rejected', note: string, by: string): Promise<void> {
    if (!isSupabaseConfigured) return demoPrivacy.resolve(id, status, note, by)
    await rpc('privacy_resolve', { p_id: id, p_status: status, p_note: note || null })
  },
}

/** save a JSON object as a file */
export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
