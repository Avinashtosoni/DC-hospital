import { addDays, format } from 'date-fns'
import type { DB, Profile, TableName } from '../types'
import { TABLES } from '../types'
import type { AuthAdapter, DataAdapter, NewRow, Row, SignUpInput } from './adapter'
import { buildSeed, DEMO_PASSWORD, DEMO_USERS } from './seed'

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
      for (const t of TABLES) if (!cache[t]) (cache as Record<string, unknown[]>)[t] = []
      return cache
    } catch { /* fallthrough to reseed */ }
  }
  cache = buildSeed(localDates) as Store
  persist()
  return cache
}
function persist() { if (cache) localStorage.setItem(DB_KEY, JSON.stringify(cache)) }

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
    persist()
    return structuredClone(full)
  },
  async update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>) {
    await latency()
    const rows = load()[table] as Row<T>[]
    const idx = rows.findIndex((r) => r.id === id)
    if (idx < 0) throw new Error('Record not found')
    rows[idx] = { ...rows[idx], ...patch, id, updated_at: new Date().toISOString() }
    persist()
    return structuredClone(rows[idx])
  },
  async remove(table, id) {
    await latency()
    const store = load() as Record<string, { id: string }[]>
    store[table] = store[table].filter((r) => r.id !== id)
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
  onChange(cb) {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
}
