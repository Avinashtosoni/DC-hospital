import type { Profile, TableName } from '../types'
import { supabase } from '../lib/supabase'
import type { AuthAdapter, DataAdapter, NewRow, Row } from './adapter'

const client = () => {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

const ORDER: Partial<Record<TableName, { column: string; ascending: boolean }>> = {
  appointments: { column: 'appointment_date', ascending: true },
  beds: { column: 'bed_number', ascending: true },
  departments: { column: 'name', ascending: true },
  wards: { column: 'name', ascending: true },
}

export const supabaseAdapter: DataAdapter = {
  mode: 'supabase',
  async list(table) {
    const order = ORDER[table] ?? { column: 'created_at', ascending: false }
    const { data, error } = await client().from(table).select('*').order(order.column, { ascending: order.ascending }).limit(5000)
    if (error) throw new Error(error.message)
    return data as never
  },
  async insert<T extends TableName>(table: T, row: NewRow<T>) {
    const { data, error } = await client().from(table).insert(row as never).select().single()
    if (error) throw new Error(error.message)
    return data as Row<T>
  },
  async update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>) {
    const { id: _ignore, created_at: _c, updated_at: _u, ...rest } = patch as Record<string, unknown>
    void _ignore; void _c; void _u
    const { data, error } = await client().from(table).update(rest as never).eq('id', id).select().single()
    if (error) throw new Error(error.message)
    return data as Row<T>
  },
  async remove(table, id) {
    const { error } = await client().from(table).delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await client().from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  return data as Profile | null
}

export const supabaseAuth: AuthAdapter = {
  async getCurrent() {
    const { data } = await client().auth.getSession()
    const uid = data.session?.user.id
    return uid ? fetchProfile(uid) : null
  },
  async signIn(email, password) {
    const { data, error } = await client().auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
    const p = await fetchProfile(data.user.id)
    if (!p) throw new Error('No profile found. Did you run supabase/master.sql?')
    return p
  },
  async signUp({ full_name, email, password, phone }) {
    const { data, error } = await client().auth.signUp({ email, password, options: { data: { full_name, phone, role: 'patient' } } })
    if (error) throw new Error(error.message)
    if (!data.session) throw new Error('Account created! Please confirm your email, then sign in.')
    const p = await fetchProfile(data.user!.id)
    if (!p) throw new Error('Profile was not created. Check the handle_new_user trigger.')
    return p
  },
  async signOut() {
    await client().auth.signOut()
  },
  onChange(cb) {
    const { data } = client().auth.onAuthStateChange(() => cb())
    return () => data.subscription.unsubscribe()
  },
}
