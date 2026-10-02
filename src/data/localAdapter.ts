import { addDays, format } from 'date-fns'
import { runQuery } from './query'
import { deriveInvoiceStatus } from '../lib/billing'
import type { DB, Profile, TableName } from '../types'
import { TABLES } from '../types'
import type { AuthAdapter, DataAdapter, InviteInfo, NewRow, Row, SignUpInput } from './adapter'
import { buildSeed, DEMO_PASSWORD, DEMO_USERS } from './seed'
import { CITY_USERS } from './citySeed'
import { auditSummary, diffRows, isAudited } from '../lib/audit'
import { CONTACT_FORM_ID } from '../forms/schema'
import { nextRun } from '../settings/schedule'
import { buildCitySeed } from './citySeed'
import { activeDemoTenant, DEMO_PROVIDERS, DEMO_TENANTS, demoKey, demoTenantById, providerAppRole, providerCan, providerProfile, providerTenants } from '../tenancy/demo'
import { demoBilling, demoLicense } from '../billing/demo'
import { activeTenantId, providerChoice, type MyContext, type ProviderRole } from '../tenancy/state'

/** each demo hospital has its own store (see src/tenancy/demo.ts) */
const dbKey = () => demoKey('dch:db:v3')
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
let cacheKey = ''
const seedFor = () => (activeDemoTenant().is_primary ? buildSeed(localDates) : buildCitySeed(localDates)) as Store

function load(): Store {
  if (cache && cacheKey === dbKey()) return cache
  cache = null; cacheKey = dbKey()                    // a provider switched hospital → that hospital's store
  const raw = localStorage.getItem(cacheKey)
  if (raw) {
    try {
      cache = JSON.parse(raw) as Store
      // tables added after this browser was seeded get their demo rows now
      const missing = TABLES.filter((t) => !cache![t])
      if (missing.length) {
        const fresh = seedFor()
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
  cache = seedFor()
  persist()
  return cache
}
function persist() { if (cache) localStorage.setItem(dbKey(), JSON.stringify(cache)) }

// ------------------------------------------------------------------ who is signed in (hospital user or provider)
/** the provider behind the session, with the mode they work in (admins can switch; others have one) */
function sessionProvider(): { p: (typeof DEMO_PROVIDERS)[number]; mode: ProviderRole } | null {
  const p = DEMO_PROVIDERS.find((x) => x.id === localStorage.getItem(SESSION_KEY))
  if (!p) return null
  const chosen = providerChoice().mode
  return { p, mode: p.role === 'admin' ? chosen ?? 'admin' : p.role }
}
/** the signed-in person as this hospital sees them (providers act as owner / accountant) */
function currentProfile(): Profile | undefined {
  const sp = sessionProvider()
  if (sp) return providerCan(sp.p, activeTenantId() ?? '') ? providerProfile(sp.p, sp.mode) : undefined
  return load().profiles.find((p) => p.id === localStorage.getItem(SESSION_KEY))
}
/** a provider only sees the hospitals assigned to them (same rule as current_tenant() in tenancy_core.sql) */
function accessGuard() {
  const sp = sessionProvider()
  if (sp && !providerCan(sp.p, activeTenantId() ?? '')) throw new Error('Your Hospital Comrade account has no access to this hospital.')
}
/** Support works in hospitals but can't change patient records (same rule as provider_support_* policies) */
const CLINICAL = ['patients', 'appointments', 'prescriptions', 'lab_tests', 'admissions', 'visit_feedback']
function supportGuard(table: string) {
  accessGuard()
  if (sessionProvider()?.mode === 'support' && CLINICAL.includes(table)) throw new Error('Support mode is read-only for patient records.')
}

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
  const actor = actorOverride ? undefined : currentProfile()
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
  const me = currentProfile()
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

/** Demo-mode mirror of the stamp triggers in scripts/sql/messaging.sql (notice author, template next run / author). */
function stampMessaging(table: TableName, row: Record<string, unknown>, isNew: boolean, before?: Record<string, unknown>) {
  const me = currentProfile()
  if (table === 'notices' && isNew && !row.author_name) row.author_name = me?.full_name ?? null
  if (table === 'notification_templates') {
    const t = row as unknown as DB['notification_templates']
    if (isNew) t.created_by_name = t.created_by_name ?? me?.full_name ?? null
    if (t.audience === 'roles' && !t.roles?.length) throw new Error('Pick at least one role to send to.')
    if (t.schedule === 'once' && t.enabled && !t.send_at) throw new Error('Pick when to send it.')
    const keys = ['enabled', 'schedule', 'send_at', 'time_of_day', 'weekday', 'month_day'] as const
    if (isNew || keys.some((k) => before?.[k] !== (t as unknown as Record<string, unknown>)[k])) t.next_run_at = nextRun(t)?.toISOString() ?? null
  }
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
    accessGuard()
    return structuredClone(load()[table]) as never
  },
  async query(table, q) {
    await latency()
    accessGuard()
    const res = runQuery(load()[table] as never[], q)
    return { rows: structuredClone(res.rows), count: res.count } as never
  },
  async insert<T extends TableName>(table: T, row: NewRow<T>) {
    await latency()
    if (!actorOverride) supportGuard(table)
    const now = new Date().toISOString()
    const full = { ...row, id: row.id ?? uuid(), created_at: now, updated_at: now } as unknown as Row<T>
    stampMessaging(table, full as unknown as Record<string, unknown>, true)
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
    supportGuard(table)
    const before = rows[idx]
    if (table === 'appointments') patientApptGuard(before as unknown as DB['appointments'], patch as Partial<DB['appointments']>)
    const next = { ...rows[idx], ...patch, id, updated_at: new Date().toISOString() }
    stampMessaging(table, next as unknown as Record<string, unknown>, false, before as unknown as Record<string, unknown>)
    rows[idx] = next
    if (table === 'payments') { const p = rows[idx] as unknown as DB['payments']; p.patient_id = load().invoices.find((i) => i.id === p.invoice_id)?.patient_id ?? p.patient_id }
    audit(table, 'update', before as unknown as Record<string, unknown>, rows[idx] as unknown as Record<string, unknown>)
    if (table === 'payments') { syncInvoiceFromPayments((before as unknown as DB['payments']).invoice_id); syncInvoiceFromPayments((rows[idx] as unknown as DB['payments']).invoice_id) }
    persist()
    return structuredClone(rows[idx])
  },
  async remove(table, id) {
    await latency()
    supportGuard(table)
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
    cache = seedFor()
    persist()
    localStorage.removeItem(USERS_KEY)
  },
}

// ------------------------------------------------------------------ local auth
/** one list of logins for the whole demo; `tenant` = the hospital the account belongs to (missing = DC Hospital),
 *  providers have no hospital (their profile lives in src/tenancy/demo.ts) */
interface LocalUser { email: string; password: string; profile_id: string; disabled?: boolean; last_sign_in_at?: string; tenant?: string; provider?: boolean }
function users(): LocalUser[] {
  let list: LocalUser[] = []
  try { list = JSON.parse(localStorage.getItem(USERS_KEY) ?? '[]') } catch { list = [] }
  // demo logins added later (second hospital, providers) also appear in browsers seeded before them
  const extras: LocalUser[] = [
    ...DEMO_USERS.map((u) => ({ email: u.email, password: DEMO_PASSWORD, profile_id: u.id })),
    ...CITY_USERS.map((u) => ({ email: u.email, password: DEMO_PASSWORD, profile_id: u.id, tenant: DEMO_TENANTS[1].id })),
    ...DEMO_PROVIDERS.map((u) => ({ email: u.email, password: DEMO_PASSWORD, profile_id: u.id, provider: true })),
  ]
  const missing = extras.filter((e) => !list.some((x) => x.profile_id === e.profile_id))
  if (missing.length) { list = [...list, ...missing]; localStorage.setItem(USERS_KEY, JSON.stringify(list)) }
  return list
}
const tenantOf = (u: LocalUser) => u.tenant ?? DEMO_TENANTS[0].id
/** logins of the hospital this tab is in */
const hospitalUsers = () => users().filter((u) => !u.provider && tenantOf(u) === activeDemoTenant().id)
const wrongHospital = (u: LocalUser) => {
  const t = demoTenantById(tenantOf(u))!
  return new Error(`This account belongs to ${t.name}. Please sign in on ${t.name}'s website (demo: add ?hospital=${t.slug} to the address).`)
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
  const u = hospitalUsers().find((x) => x.email.toLowerCase() === email.trim().toLowerCase())
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
    const sp = sessionProvider()
    if (sp) return providerProfile(sp.p, sp.mode)
    return load().profiles.find((p) => p.id === id) ?? null   // another hospital's account → not signed in here
  },
  async signIn(email, password) {
    await latency()
    const u = users().find((x) => x.email.toLowerCase() === email.trim().toLowerCase())
    if (!u || u.password !== password) throw new Error('Invalid email or password')
    if (u.disabled) throw new Error('This account has been disabled. Please contact the hospital.')
    if (!u.provider && tenantOf(u) !== activeDemoTenant().id) throw wrongHospital(u)   // one account = one hospital
    u.last_sign_in_at = new Date().toISOString()
    localStorage.setItem(USERS_KEY, JSON.stringify(users().map((x) => (x.profile_id === u.profile_id ? u : x))))
    if (u.provider) {
      const p = DEMO_PROVIDERS.find((x) => x.id === u.profile_id)!
      localStorage.setItem(SESSION_KEY, p.id)
      emit()
      return providerProfile(p, p.role)
    }
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
        id: uuid(), profile_id: profile.id, mrn: `${activeDemoTenant().code}-${nextMrn}`, full_name, email, phone: phone ?? null,
        gender: 'other', status: 'outpatient', created_at: now, updated_at: now,
      })
    }
    persist()
    list.push({ email, password, profile_id: profile.id, tenant: activeDemoTenant().id })
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
    const u = hospitalUsers().find((x) => x.email.toLowerCase() === email.trim().toLowerCase())
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

// ------------------------------------------------------------------ user administration (demo twins of admin_* in messaging.sql)
const ROLES = ['owner', 'doctor', 'receptionist', 'accountant', 'staff', 'patient']
function adminGuard() {
  const me = currentProfile()
  if (me?.role !== 'owner') throw new Error('Only the hospital owner can manage user accounts')
  return me
}
const owners = () => load().profiles.filter((p) => p.role === 'owner').length
export const localAdmin = {
  async create(input: { email: string; full_name: string; role: Profile['role']; phone?: string | null; password?: string | null }): Promise<string> {
    await latency(); adminGuard()
    const email = input.email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid e-mail address')
    if (input.full_name.trim().length < 2) throw new Error('Enter the full name')
    if (!ROLES.includes(input.role)) throw new Error('Choose a role')
    if (input.password && input.password.length < 8) throw new Error('Use at least 8 characters for the password')
    const list = users()
    if (list.some((x) => x.email.toLowerCase() === email)) throw new Error('An account with this e-mail already exists')
    const store = load(), now = new Date().toISOString()
    const profile: Profile = { id: uuid(), full_name: input.full_name.trim(), email, role: input.role, phone: input.phone?.trim() || null, created_at: now, updated_at: now }
    store.profiles.unshift(profile)
    audit('profiles', 'insert', null, profile as unknown as Record<string, unknown>)
    if (input.role === 'patient') {
      const nextMrn = Math.max(100000, ...store.patients.map((p) => Number(p.mrn.replace(/\D/g, '')) || 0)) + 1
      store.patients.unshift({ id: uuid(), profile_id: profile.id, mrn: `${activeDemoTenant().code}-${nextMrn}`, full_name: profile.full_name, email, phone: profile.phone, gender: 'other', status: 'outpatient', created_at: now, updated_at: now })
    } else {
      const linked = (input.role === 'doctor' ? store.doctors : store.staff) as { email?: string | null; profile_id?: string | null }[]
      const match = linked.find((r) => r.email?.toLowerCase() === email && !r.profile_id)
      if (match) match.profile_id = profile.id
    }
    persist()
    list.push({ email, password: input.password || crypto.randomUUID(), profile_id: profile.id, tenant: activeDemoTenant().id })
    localStorage.setItem(USERS_KEY, JSON.stringify(list))
    return profile.id
  },
  async update(id: string, input: { full_name: string; role: Profile['role']; phone?: string | null; email?: string | null }) {
    await latency(); const me = adminGuard()
    const store = load()
    const p = store.profiles.find((x) => x.id === id)
    if (!p) throw new Error('User not found')
    if (input.full_name.trim().length < 2) throw new Error('Enter the full name')
    if (p.role === 'owner' && input.role !== 'owner' && (id === me.id || owners() <= 1)) throw new Error("You can't remove your own owner access or the last owner")
    const email = (input.email ?? '').trim().toLowerCase()
    const list = users()
    if (email && email !== p.email.toLowerCase()) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid e-mail address')
      if (list.some((x) => x.email.toLowerCase() === email && x.profile_id !== id)) throw new Error('Another account already uses this e-mail')
      const u = list.find((x) => x.profile_id === id); if (u) u.email = email
      localStorage.setItem(USERS_KEY, JSON.stringify(list))
    }
    const before = { ...p }
    Object.assign(p, { full_name: input.full_name.trim(), role: input.role, phone: input.phone?.trim() || null, email: email || p.email, updated_at: new Date().toISOString() })
    audit('profiles', 'update', before as unknown as Record<string, unknown>, p as unknown as Record<string, unknown>)
    persist()
  },
  async setPassword(id: string, password: string) {
    await latency(); adminGuard()
    if (password.length < 8) throw new Error('Use at least 8 characters')
    localSetPassword(id, password)
  },
  async setActive(id: string, active: boolean) {
    await latency(); const me = adminGuard()
    if (id === me.id) throw new Error("You can't disable your own account")
    const list = users(); const u = list.find((x) => x.profile_id === id)
    if (!u) throw new Error('No login found for this account')
    u.disabled = !active
    localStorage.setItem(USERS_KEY, JSON.stringify(list))
  },
  async status(ids: string[]): Promise<{ id: string; disabled: boolean; last_sign_in_at: string | null }[]> {
    const list = users()
    return ids.map((id) => { const u = list.find((x) => x.profile_id === id); return { id, disabled: !!u?.disabled, last_sign_in_at: u?.last_sign_in_at ?? null } })
  },
  async remove(id: string) {
    await latency(); const me = adminGuard()
    if (id === me.id) throw new Error("You can't delete your own account")
    const store = load()
    const p = store.profiles.find((x) => x.id === id)
    if (p?.role === 'owner' && owners() <= 1) throw new Error("You can't delete the last owner")
    store.profiles = store.profiles.filter((x) => x.id !== id)
    for (const t of ['patients', 'doctors', 'staff'] as const) for (const r of store[t] as { profile_id?: string | null }[]) if (r.profile_id === id) r.profile_id = null
    if (p) audit('profiles', 'delete', p as unknown as Record<string, unknown>, null)
    persist()
    localStorage.setItem(USERS_KEY, JSON.stringify(users().filter((x) => x.profile_id !== id)))
  },
}

/** Demo stand-in for notify_template_recipients(): who a custom message would reach. */
export function localTemplateRecipients(t: DB['notification_templates']): { profile_id: string | null; full_name: string; phone: string | null; email: string | null }[] {
  const store = load()
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(5, 10)
  const out: { profile_id: string | null; full_name: string; phone: string | null; email: string | null }[] = []
  const patientsToo = t.schedule === 'birthday' || t.audience === 'patients' || t.audience === 'everyone' || (t.audience === 'roles' && t.roles.includes('patient'))
  if (patientsToo) for (const p of store.patients) {
    if (t.schedule === 'birthday' && (p.date_of_birth ?? '').slice(5, 10) !== today) continue
    out.push({ profile_id: p.profile_id ?? null, full_name: p.full_name, phone: p.phone ?? null, email: p.email ?? null })
  }
  if (t.schedule !== 'birthday') for (const p of store.profiles) {
    if (p.role === 'patient') continue
    if (!(t.audience === 'staff' || t.audience === 'everyone' || (t.audience === 'roles' && t.roles.includes(p.role)))) continue
    out.push({ profile_id: p.id, full_name: p.full_name, phone: p.phone ?? null, email: p.email })
  }
  const seen = new Set<string>()
  return out.filter((r) => { const k = (r.phone ?? '').replace(/\D/g, '').slice(-10) || r.email?.toLowerCase() || r.profile_id || ''; if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 5000)
}
export function localMarkTemplateRun(id: string, count: number) {
  const t = load().notification_templates.find((x) => x.id === id)
  if (t) { t.last_run_at = new Date().toISOString(); t.last_run_count = count; persist() }
}

// ------------------------------------------------------------------ demo twins of my_context() / provider_tenants()
export function localMyContext(): MyContext {
  const t = activeDemoTenant()
  const sp = sessionProvider()
  if (sp) {
    const ok = providerCan(sp.p, t.id)
    const license = ok ? demoLicense(t.id, true) : null
    const tenant = { id: t.id, slug: t.slug, name: t.name, status: license?.status ?? t.status, plan: demoBilling(t.id)?.plan ?? t.plan, modules: t.modules, is_primary: t.is_primary }
    return { tenant: ok ? tenant : null, role: ok ? providerAppRole(sp.mode) : null, provider_role: sp.p.role, provider_mode: sp.mode, license }
  }
  const u = users().find((x) => x.profile_id === localStorage.getItem(SESSION_KEY))
  const home = u ? demoTenantById(tenantOf(u)) : undefined
  const role = currentProfile()?.role ?? null
  const license = home ? demoLicense(home.id, role === 'owner' || role === 'accountant') : null
  return {
    tenant: home ? { id: home.id, slug: home.slug, name: home.name, status: license?.status ?? home.status, plan: demoBilling(home.id)?.plan ?? home.plan, modules: home.modules, is_primary: home.is_primary } : null,
    role, provider_role: null, provider_mode: null, license,
  }
}
export function localProviderTenants() {
  const sp = sessionProvider()
  return sp ? providerTenants(sp.p).map((t) => ({ id: t.id, slug: t.slug, name: t.name, status: demoLicense(t.id, false)?.status ?? t.status, plan: demoBilling(t.id)?.plan ?? t.plan, modules: t.modules, is_primary: t.is_primary, domain: t.domain })) : []
}
