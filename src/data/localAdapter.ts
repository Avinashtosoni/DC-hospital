import { addDays, format } from 'date-fns'
import { runQuery } from './query'
import { deriveInvoiceStatus } from '../lib/billing'
import type { DB, Profile, TableName } from '../types'
import { TABLES } from '../types'
import type { AuthAdapter, DataAdapter, InviteInfo, NewRow, Row, SignUpInput } from './adapter'
import { buildSeed, DEMO_PASSWORD, DEMO_USERS } from './seed'
import { auditSummary, diffRows, isAudited } from '../lib/audit'
import { CONTACT_FORM_ID } from '../forms/schema'

const DB_KEY = 'dch:db:v3'
const USERS_KEY = 'dch:auth-users:v1'
const SESSION_KEY = 'dch:session:v1'

type Store = { [K in TableName]: DB[K][] }

const localDates = {
  date: (o: number) => format(addDays(new Date(), o), 'yyyy-MM-dd'),
  ts: (o: number, t = '09:00') => {
    const [h, m] = t.split(':').map(Number)
    const dt = addDays(new Date(), o)
    dt.setHours(h, m, 0, 0)
    return dt.toISOString()
  },
}

let cache: Store | null = null

function load(): Store {
  if (cache) return cache
  const raw = localStorage.getItem(DB_KEY)
  if (raw) {
    try {
      cache = JSON.parse(raw) as Store
      // tables added after this browser was seeded get their demo rows now
      const missing = TABLES.filter((t) => !cache![t])
      if (missing.length) {
        const fresh = buildSeed(localDates) as Store
        for (const t of missing) (cache as Record<string, unknown[]>)[t] = fresh[t] ?? []
        persist()
      }
      // messages saved before Settings → Forms existed belong to the Contact form (same backfill as scripts/sql/forms.sql)
      const legacy = (cache.site_enquiries ?? []).filter((e) => !e.form_id)
      if (legacy.length) {
        for (const e of legacy) { e.form_id = CONTACT_FORM_ID; e.form_name = e.form_name ?? 'Contact form' }
        persist()
      }
      return cache
    } catch { /* fallthrough to reseed */ }
  }
  cache = buildSeed(localDates) as Store
  persist()
  return cache
}
function persist() { if (cache) localStorage.setItem(DB_KEY, JSON.stringify(cache)) }

/** Label writes made on behalf of a system process (e.g. the public booking API) instead of the signed-in user. */
let actorOverride: { name: string; role: string } | null = null
export async function asActor<T>(name: string, role: string, fn: () => Promise<T>): Promise<T> {
  actorOverride = { name, role }
  try { return await fn() } finally { actorOverride = null }
}

/** Child tables whose rows block deleting a parent (mirrors `on delete restrict` in scripts/sql/schema.sql). */
const RESTRICT: Partial<Record<string, [string, string][]>> = {
  patients: [['appointments', 'patient_id'], ['prescriptions', 'patient_id'], ['lab_tests', 'patient_id'], ['admissions', 'patient_id'], ['invoices', 'patient_id'], ['payments', 'patient_id']],
  doctors: [['appointments', 'doctor_id'], ['prescriptions', 'doctor_id']],
  invoices: [['payments', 'invoice_id']],
}

/** Demo-mode equivalent of the audit triggers in scripts/sql/audit.sql. */
function audit(table: TableName, action: 'insert' | 'update' | 'delete', before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  if (!isAudited(table)) return
  const changes = diffRows(before, after)
  if (action === 'update' && !Object.keys(changes).length) return
  const store = load()
  const actorId = actorOverride ? null : localStorage.getItem(SESSION_KEY)
  const actor = actorId ? store.profiles.find((p) => p.id === actorId) : undefined
  const row = (after ?? before) as Record<string, unknown>
  store.audit_log.unshift({
    id: uuid(), table_name: table, record_id: (row.id as string) ?? null, action, changes,
    actor_id: actor?.id ?? null, actor_name: actor?.full_name ?? actorOverride?.name ?? 'System', actor_role: actor?.role ?? actorOverride?.role ?? 'system',
    summary: auditSummary(table, row), created_at: new Date().toISOString(),
  })
  if (store.audit_log.length > 3000) store.audit_log.length = 3000
}

const latency = () => new Promise((r) => setTimeout(r, 180 + Math.random() * 260))
const uuid = () => crypto.randomUUID()

/** Demo-mode mirror of trg_appointments_patient_guard (scripts/sql/patient.sql): patients may only cancel or move
 *  their own upcoming visit to a free slot — every other field is locked. */
function patientApptGuard(a: DB['appointments'], patch: Partial<DB['appointments']>) {
  const store = load()
  const me = store.profiles.find((p) => p.id === localStorage.getItem(SESSION_KEY))
  if (me?.role !== 'patient') return
  const mine = store.patients.find((p) => p.profile_id === me.id)
  if (!mine || a.patient_id !== mine.id) throw new Error('You can only change your own appointments.')
  const locked = Object.keys(patch).filter((k) => !['appointment_date', 'appointment_time', 'status', 'reason'].includes(k) && (patch as Record<string, unknown>)[k] !== (a as unknown as Record<string, unknown>)[k])
  if (locked.length) throw new Error('Only the date and time of an appointment can be changed.')
  if (!['scheduled', 'confirmed'].includes(a.status)) throw new Error('This appointment can no longer be changed online.')
  const date = patch.appointment_date ?? a.appointment_date, time = (patch.appointment_time ?? a.appointment_time).slice(0, 5)
  const moved = date !== a.appointment_date || time !== a.appointment_time.slice(0, 5)
  if (patch.status && patch.status !== a.status && patch.status !== 'cancelled' && !(moved && patch.status === 'scheduled')) throw new Error('You can only cancel an appointment.')
  if (!moved) return
  if (new Date(`${date}T${time}:00`).getTime() <= Date.now()) throw new Error('SLOT_PAST: Please pick a future time.')
  const clash = store.appointments.some((x) => x.id !== a.id && x.doctor_id === a.doctor_id && x.appointment_date === date && x.appointment_time.slice(0, 5) === time && !['cancelled', 'no_show'].includes(x.status))
  if (clash) throw new Error('SLOT_TAKEN: Sorry — someone just booked this slot. Please pick another time.')
  patch.status = 'scheduled'
}

/** Demo-mode mirror of trg_payments_sync_invoice (scripts/sql/scale.sql): an invoice's amount_paid is always the
 *  sum of its payments and its status follows from it. */
function syncInvoiceFromPayments(invoiceId: string | undefined) {
  if (!invoiceId) return
  const store = load()
  const inv = store.invoices.find((i) => i.id === invoiceId)
  if (!inv) return
  const before = { ...inv }
  inv.amount_paid = Math.round(store.payments.filter((p) => p.invoice_id === invoiceId).reduce((s, p) => s + Number(p.amount), 0) * 100) / 100
  inv.status = deriveInvoiceStatus(inv)
  if (inv.amount_paid !== before.amount_paid || inv.status !== before.status) {
    inv.updated_at = new Date().toISOString()
    audit('invoices', 'update', before as unknown as Record<string, unknown>, inv as unknown as Record<string, unknown>)
  }
}

export const localAdapter: DataAdapter = {
  mode: 'local',
  async list(table) {
    await latency()
    return structuredClone(load()[table]) as never
  },
  async query(table, q) {
    await latency()
    const res = runQuery(load()[table] as never[], q)
    return { rows: structuredClone(res.rows), count: res.count } as never
  },
  async insert<T extends TableName>(table: T, row: NewRow<T>) {
    await latency()
    const now = new Date().toISOString()
    const full = { ...row, id: row.id ?? uuid(), created_at: now, updated_at: now } as unknown as Row<T>
    if (table === 'site_enquiries') { const e = full as unknown as DB['site_enquiries']; if (!e.form_id) { e.form_id = CONTACT_FORM_ID; e.form_name = e.form_name ?? 'Contact form' } }
    if (table === 'payments') { // trg_payments_sync_invoice also stamps the patient from the invoice
      const p = full as unknown as DB['payments']
      p.patient_id = load().invoices.find((i) => i.id === p.invoice_id)?.patient_id ?? p.patient_id
    }
    ;(load()[table] as Row<T>[]).unshift(full)
    audit(table, 'insert', null, full as unknown as Record<string, unknown>)
    if (table === 'payments') syncInvoiceFromPayments((full as unknown as DB['payments']).invoice_id)
    persist()
    return structuredClone(full)
  },
  async update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>) {
    await latency()
    const rows = load()[table] as Row<T>[]
    const idx = rows.findIndex((r) => r.id === id)
    if (idx < 0) throw new Error('Record not found')
    const before = rows[idx]
    if (table === 'appointments') patientApptGuard(before as unknown as DB['appointments'], patch as Partial<DB['appointments']>)
    rows[idx] = { ...rows[idx], ...patch, id, updated_at: new Date().toISOString() }
    if (table === 'payments') { const p = rows[idx] as unknown as DB['payments']; p.patient_id = load().invoices.find((i) => i.id === p.invoice_id)?.patient_id ?? p.patient_id }
    audit(table, 'update', before as unknown as Record<string, unknown>, rows[idx] as unknown as Record<string, unknown>)
    if (table === 'payments') { syncInvoiceFromPayments((before as unknown as DB['payments']).invoice_id); syncInvoiceFromPayments((rows[idx] as unknown as DB['payments']).invoice_id) }
    persist()
    return structuredClone(rows[idx])
  },
  async remove(table, id) {
    await latency()
    const store = load() as Record<string, { id: string }[]>
    // same rule as the database (on delete restrict): clinical and billing history is never deleted along with a person
    const linked = (RESTRICT[table] ?? []).some(([child, col]) => (store[child] ?? []).some((r) => (r as unknown as Record<string, unknown>)[col] === id))
    if (linked) throw new Error('This record can\'t be deleted because appointments, bills or medical records are linked to it. Mark it inactive or cancelled instead.')
    const before = store[table].find((r) => r.id === id)
    store[table] = store[table].filter((r) => r.id !== id)
    if (before) audit(table, 'delete', before as Record<string, unknown>, null)
    if (table === 'payments') syncInvoiceFromPayments((before as unknown as DB['payments'] | undefined)?.invoice_id)
    persist()
  },
  async reset() {
    cache = buildSeed(localDates) as Store
    persist()
    localStorage.removeItem(USERS_KEY)
  },
}

// ------------------------------------------------------------------ local auth
interface LocalUser { email: string; password: string; profile_id: string }
function users(): LocalUser[] {
  const raw = localStorage.getItem(USERS_KEY)
  if (raw) return JSON.parse(raw)
  const seeded = DEMO_USERS.map((u) => ({ email: u.email, password: DEMO_PASSWORD, profile_id: u.id }))
  localStorage.setItem(USERS_KEY, JSON.stringify(seeded))
  return seeded
}
const RESET_KEY = 'dch:demo-reset'
const readReset = (): { token: string; profile_id: string; expires: number } | null => { try { return JSON.parse(localStorage.getItem(RESET_KEY) ?? 'null') } catch { return null } }
/** demo store: set a login's password (used by both "Forgot password" options) */
export function localSetPassword(profileId: string, password: string) {
  const list = users()
  const u = list.find((x) => x.profile_id === profileId)
  if (!u) throw new Error('No login found for this account')
  u.password = password
  localStorage.setItem(USERS_KEY, JSON.stringify(list))
}
/** demo store: the login whose e-mail AND mobile (profile or patient record) match — same rule as request_password_otp() */
export function localFindByEmailPhone(email: string, phone10: string): string | null {
  const u = users().find((x) => x.email.toLowerCase() === email.trim().toLowerCase())
  if (!u) return null
  const store = load()
  const p10 = (v?: string | null) => (v ?? '').replace(/\D/g, '').slice(-10)
  const prof = store.profiles.find((p) => p.id === u.profile_id)
  const ok = p10(prof?.phone) === phone10 || store.patients.some((pt) => pt.profile_id === u.profile_id && p10(pt.phone) === phone10)
  return ok ? u.profile_id : null
}
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const localAuth: AuthAdapter = {
  async getCurrent() {
    const id = localStorage.getItem(SESSION_KEY)
    if (!id) return null
    return load().profiles.find((p) => p.id === id) ?? null
  },
  async signIn(email, password) {
    await latency()
    const u = users().find((x) => x.email.toLowerCase() === email.trim().toLowerCase())
    if (!u || u.password !== password) throw new Error('Invalid email or password')
    const profile = load().profiles.find((p) => p.id === u.profile_id)
    if (!profile) throw new Error('Profile not found for this account')
    localStorage.setItem(SESSION_KEY, profile.id)
    emit()
    return profile
  },
  async signUp({ full_name, email, password, phone, invite_token }: SignUpInput) {
    await latency()
    const list = users()
    if (list.some((x) => x.email.toLowerCase() === email.toLowerCase())) throw new Error('An account with this email already exists')
    const store = load()
    const now = new Date().toISOString()
    // same rules as handle_new_user(): a valid invite for this e-mail gives its role, otherwise patient
    const invite = invite_token ? store.staff_invites.find((i) => i.token === invite_token && i.status === 'pending'
      && i.email.toLowerCase() === email.toLowerCase() && new Date(i.expires_at).getTime() > Date.now()) : undefined
    const profile: Profile = { id: uuid(), full_name, email, role: invite?.role ?? 'patient', phone: phone || invite?.phone || null, created_at: now, updated_at: now }
    store.profiles.unshift(profile)
    if (invite) {
      Object.assign(invite, { status: 'accepted', accepted_at: now, updated_at: now })
      const linked = invite.role === 'doctor' ? store.doctors : store.staff
      const match = (linked as { email?: string | null; profile_id?: string | null }[]).find((r) => r.email?.toLowerCase() === email.toLowerCase() && !r.profile_id)
      if (match) match.profile_id = profile.id
    } else {
      const nextMrn = Math.max(100000, ...store.patients.map((p) => Number(p.mrn.replace(/\D/g, '')) || 0)) + 1
      store.patients.unshift({
        id: uuid(), profile_id: profile.id, mrn: `DCH-${nextMrn}`, full_name, email, phone: phone ?? null,
        gender: 'other', status: 'outpatient', created_at: now, updated_at: now,
      })
    }
    persist()
    list.push({ email, password, profile_id: profile.id })
    localStorage.setItem(USERS_KEY, JSON.stringify(list))
    localStorage.setItem(SESSION_KEY, profile.id)
    emit()
    return profile
  },
  async signOut() {
    localStorage.removeItem(SESSION_KEY)
    emit()
  },
  async changePassword(current, next) {
    await latency()
    const id = localStorage.getItem(SESSION_KEY)
    const list = users()
    const u = list.find((x) => x.profile_id === id)
    if (!u) throw new Error('No local login found for this account')
    if (u.password !== current) throw new Error('Your current password is incorrect')
    u.password = next
    localStorage.setItem(USERS_KEY, JSON.stringify(list))
  },
  // demo mode: no e-mail is sent — the reset link is handed back so it can be opened right away
  async requestPasswordReset(email, redirectTo) {
    await latency()
    const u = users().find((x) => x.email.toLowerCase() === email.trim().toLowerCase())
    if (!u) return {}
    const token = crypto.randomUUID()
    localStorage.setItem(RESET_KEY, JSON.stringify({ token, profile_id: u.profile_id, expires: Date.now() + 3600e3 }))
    return { demoLink: `${redirectTo}#demo_token=${token}` }
  },
  async hasRecoverySession() {
    const t = new URLSearchParams(window.location.hash.slice(1)).get('demo_token')
    const r = readReset()
    return !!t && !!r && r.token === t && r.expires > Date.now()
  },
  async setNewPassword(next) {
    await latency()
    const r = readReset()
    if (!r || r.expires < Date.now()) throw new Error('This reset link has expired. Please request a new one.')
    localSetPassword(r.profile_id, next)
    localStorage.removeItem(RESET_KEY)
  },
  async signOutEverywhere() {
    localStorage.removeItem(SESSION_KEY)
    emit()
  },
  async uploadAvatar(_userId, file) {
    // demo mode keeps the (already downscaled) image inline
    return await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file) })
  },
  onChange(cb) {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
}

/** Demo-mode twin of the invite_lookup() RPC. */
export function localInviteLookup(token: string): InviteInfo {
  const i = load().staff_invites.find((x) => x.token === token && x.status === 'pending' && new Date(x.expires_at).getTime() > Date.now())
  return i ? { ok: true, email: i.email, full_name: i.full_name, role: i.role, phone: i.phone } : { ok: false, error: 'This invitation link is invalid or has expired. Ask the hospital to send a new one.' }
}

/** Demo-mode twins of feedback_context() / submit_feedback(). */
export function localFeedbackContext(apptId: string) {
  const store = load()
  const a = store.appointments.find((x) => x.id === apptId)
  const limit = format(addDays(new Date(), -60), 'yyyy-MM-dd')
  if (!a || a.status !== 'completed' || a.appointment_date < limit) return { ok: false as const, error: 'This feedback link has expired.' }
  const p = store.patients.find((x) => x.id === a.patient_id)
  const d = store.doctors.find((x) => x.id === a.doctor_id)
  return { ok: true as const, first_name: (p?.full_name ?? '').split(' ')[0], doctor: d?.full_name ?? '', specialization: d?.specialization ?? '',
    date: a.appointment_date, submitted: store.visit_feedback.some((f) => f.appointment_id === a.id) }
}
export async function localSubmitFeedback(apptId: string, input: { rating: number; comment?: string | null; tags?: string[]; would_recommend?: boolean | null }, source: 'portal' | 'link') {
  const ctx = localFeedbackContext(apptId)
  if (!ctx.ok) throw new Error(ctx.error)
  if (ctx.submitted) throw new Error('Thank you — feedback for this visit has already been received.')
  const a = load().appointments.find((x) => x.id === apptId)!
  await localAdapter.insert('visit_feedback', {
    appointment_id: a.id, patient_id: a.patient_id, doctor_id: a.doctor_id, rating: input.rating,
    comment: input.comment?.trim() || null, tags: input.tags ?? [], would_recommend: input.would_recommend ?? null, source,
  } as never)
}
