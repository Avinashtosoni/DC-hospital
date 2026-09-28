import { addDays, format } from 'date-fns'
import type { DB, Profile, TableName } from '../types'
import { TABLES } from '../types'
import type { AuthAdapter, DataAdapter, NewRow, Row, SignUpInput } from './adapter'
import { buildSeed, DEMO_PASSWORD, DEMO_USERS } from './seed'
import { auditSummary, diffRows, isAudited } from '../lib/audit'

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

export const localAdapter: DataAdapter = {
  mode: 'local',
  async list(table) {
    await latency()
    return structuredClone(load()[table]) as never
  },
  async insert<T extends TableName>(table: T, row: NewRow<T>) {
    await latency()
    const now = new Date().toISOString()
    const full = { ...row, id: row.id ?? uuid(), created_at: now, updated_at: now } as unknown as Row<T>
    ;(load()[table] as Row<T>[]).unshift(full)
    audit(table, 'insert', null, full as unknown as Record<string, unknown>)
    persist()
    return structuredClone(full)
  },
  async update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>) {
    await latency()
    const rows = load()[table] as Row<T>[]
    const idx = rows.findIndex((r) => r.id === id)
    if (idx < 0) throw new Error('Record not found')
    const before = rows[idx]
    rows[idx] = { ...rows[idx], ...patch, id, updated_at: new Date().toISOString() }
    audit(table, 'update', before as unknown as Record<string, unknown>, rows[idx] as unknown as Record<string, unknown>)
    persist()
    return structuredClone(rows[idx])
  },
  async remove(table, id) {
    await latency()
    const store = load() as Record<string, { id: string }[]>
    const before = store[table].find((r) => r.id === id)
    store[table] = store[table].filter((r) => r.id !== id)
    if (before) audit(table, 'delete', before as Record<string, unknown>, null)
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
  async signUp({ full_name, email, password, phone }: SignUpInput) {
    await latency()
    const list = users()
    if (list.some((x) => x.email.toLowerCase() === email.toLowerCase())) throw new Error('An account with this email already exists')
    const store = load()
    const now = new Date().toISOString()
    const profile: Profile = { id: uuid(), full_name, email, role: 'patient', phone: phone ?? null, created_at: now, updated_at: now }
    store.profiles.unshift(profile)
    const nextMrn = Math.max(100000, ...store.patients.map((p) => Number(p.mrn.replace(/\D/g, '')) || 0)) + 1
    store.patients.unshift({
      id: uuid(), profile_id: profile.id, mrn: `DCH-${nextMrn}`, full_name, email, phone: phone ?? null,
      gender: 'other', status: 'outpatient', created_at: now, updated_at: now,
    })
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
