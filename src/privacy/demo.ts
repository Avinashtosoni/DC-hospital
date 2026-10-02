/**
 * Demo mode twin of the phase 7 privacy RPCs (scripts/sql/compliance.sql) — same rules, kept in this browser:
 * one open request per kind, a rejection needs a note, erasure anonymises the patient.
 */
import { activeDemoTenant, demoKey } from '../tenancy/demo'
import { loadLocal } from '../data/local'
import type { MyPrivacy, PrivacyRequest, PrivacyStatus } from './api'

interface Store { requests: PrivacyRequest[]; consents: { at: string; profile_id: string; patient_id: string; purpose: string; granted: boolean; source: string }[] }
const key = () => demoKey('dch:privacy:v1')
const wait = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

function load(): Store {
  try { const v = localStorage.getItem(key()); if (v) return JSON.parse(v) as Store } catch { /* fresh */ }
  return { requests: [], consents: [] }
}
const save = (s: Store) => { try { localStorage.setItem(key(), JSON.stringify(s)) } catch { /* private mode */ } }

async function patientOf(profileId: string) {
  const db = (await loadLocal()).localSnapshot()
  const profile = db.profiles.find((p) => p.id === profileId)
  if (!profile || profile.role !== 'patient') throw new Error('Only patients can do this.')
  const patient = db.patients.find((p) => p.profile_id === profileId)
  return { db, profile, patient }
}

export const demoPrivacy = {
  async mine(profileId: string): Promise<MyPrivacy> {
    await wait()
    const db = (await loadLocal()).localSnapshot()
    const p = db.patients.find((x) => x.profile_id === profileId) as { marketing_opt_out?: boolean } | undefined
    return { marketing: !p?.marketing_opt_out, requests: load().requests.filter((r) => r.profile_id === profileId) }
  },

  async exportMine(profileId: string): Promise<Record<string, unknown>> {
    await wait(400)
    const { db, profile, patient } = await patientOf(profileId)
    const s = load()
    const mine = <T extends { patient_id?: string | null }>(rows: T[]) => (patient ? rows.filter((r) => r.patient_id === patient.id) : [])
    const out = {
      generated_at: new Date().toISOString(),
      hospital: activeDemoTenant().name,
      account: profile, patient: patient ?? null,
      appointments: mine(db.appointments), prescriptions: mine(db.prescriptions), lab_tests: mine(db.lab_tests), admissions: mine(db.admissions),
      invoices: mine(db.invoices), payments: mine(db.payments), visit_feedback: mine(db.visit_feedback),
      consents: s.consents.filter((c) => c.profile_id === profileId).map(({ at, purpose, granted, source }) => ({ at, purpose, granted, source })),
      requests: s.requests.filter((r) => r.profile_id === profileId).map((r) => ({ at: r.created_at, kind: r.kind, status: r.status, details: r.details, resolution: r.resolution })),
    }
    s.requests.unshift({ id: uid(), created_at: new Date().toISOString(), profile_id: profileId, patient_id: patient?.id ?? null, requester_name: profile.full_name,
      kind: 'access', details: 'Downloaded from the patient portal', status: 'done', resolved_at: new Date().toISOString(), resolved_by_name: null, resolution: 'Self-service download' })
    save(s)
    return out
  },

  async setMarketing(profileId: string, granted: boolean) {
    await wait()
    const { patient } = await patientOf(profileId)
    if (!patient) throw new Error('Your login is not linked to a patient record yet.')
    ;(await loadLocal()).localSetMarketingOptOut(patient.id, !granted)
    const s = load()
    s.consents.push({ at: new Date().toISOString(), profile_id: profileId, patient_id: patient.id, purpose: 'marketing', granted, source: 'portal' })
    save(s)
  },

  async submit(profileId: string, kind: 'correction' | 'erasure', details: string) {
    await wait()
    if (kind !== 'correction' && kind !== 'erasure') throw new Error('Ask for a correction or erasure.')
    if (kind === 'correction' && details.trim().length < 5) throw new Error('Tell the hospital what is wrong and what it should be.')
    const { profile, patient } = await patientOf(profileId)
    const s = load()
    if (s.requests.some((r) => r.profile_id === profileId && r.kind === kind && r.status === 'open')) throw new Error(`You already have an open ${kind} request — the hospital will reply soon.`)
    s.requests.unshift({ id: uid(), created_at: new Date().toISOString(), profile_id: profileId, patient_id: patient?.id ?? null, requester_name: profile.full_name,
      kind, details: details.trim() || null, status: 'open', resolved_at: null, resolved_by_name: null, resolution: null })
    save(s)
  },

  async list(status: PrivacyStatus | 'all'): Promise<PrivacyRequest[]> {
    await wait()
    return load().requests.filter((r) => status === 'all' || r.status === status)
  },

  async resolve(id: string, status: 'done' | 'rejected', note: string, by: string) {
    await wait(300)
    const s = load()
    const r = s.requests.find((x) => x.id === id)
    if (!r) throw new Error('Request not found')
    if (r.status !== 'open') throw new Error('This request was already answered.')
    if (status === 'rejected' && note.trim().length < 3) throw new Error('Say why the request is rejected — the patient sees it.')
    if (status === 'done' && r.kind === 'erasure' && r.patient_id) (await loadLocal()).localErasePatient(r.patient_id, note || 'privacy request')
    Object.assign(r, { status, resolution: note.trim() || null, resolved_at: new Date().toISOString(), resolved_by_name: by })
    save(s)
  },
}
