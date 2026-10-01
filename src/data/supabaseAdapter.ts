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

const PAGE = 1000
/** safety net for a runaway table; the dashboard keeps lists in memory */
const MAX_ROWS = 100_000

export const supabaseAdapter: DataAdapter = {
  mode: 'supabase',
  // PostgREST returns at most `max-rows` (1000 on Supabase) per request, so read page by page.
  // `id` is a tie-breaker so rows with the same sort value never repeat or go missing between pages.
  async list(table) {
    const order = ORDER[table] ?? { column: 'created_at', ascending: false }
    const out: unknown[] = []
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      const { data, error } = await client().from(table).select('*')
        .order(order.column, { ascending: order.ascending }).order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw friendlyDbError(error)
      out.push(...(data ?? []))
      if (!data || data.length < PAGE) break
    }
    if (out.length >= MAX_ROWS && !warnedTruncated) {
      warnedTruncated = true
      console.warn(`[dc-hospital] ${table}: only the latest ${MAX_ROWS} rows are loaded in the browser`)
    }
    return out as never
  },
  async insert<T extends TableName>(table: T, row: NewRow<T>) {
    const { data, error } = await client().from(table).insert(row as never).select().single()
    if (error) throw friendlyDbError(error)
    return data as Row<T>
  },
  async update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>) {
    const { id: _ignore, created_at: _c, updated_at: _u, ...rest } = patch as Record<string, unknown>
    void _ignore; void _c; void _u
    const { data, error } = await client().from(table).update(rest as never).eq('id', id).select().single()
    if (error) throw friendlyDbError(error)
    return data as Row<T>
  },
  async remove(table, id) {
    const { error } = await client().from(table).delete().eq('id', id)
    if (error) throw friendlyDbError(error, 'delete')
  },
}

/** Turn Postgres / PostgREST errors into something a receptionist can act on. */
export function friendlyDbError(error: { message: string; code?: string; details?: string | null }, action: 'save' | 'delete' = 'save'): Error {
  const c = error.code ?? ''
  if (c === '23503' || c === '23001') {
    return new Error(action === 'delete'
      ? 'This record can\'t be deleted because appointments, bills or medical records are linked to it. Mark it inactive or cancelled instead.'
      : 'A linked record (patient, doctor or invoice) no longer exists. Refresh the page and try again.')
  }
  if (c === '23505') return new Error(`That value is already in use${error.details ? ` (${error.details.replace(/^Key \((.+?)\)=\((.+?)\).*$/, '$1 $2')})` : ''}. Please use a different one.`)
  if (c === '42501' || /row-level security|permission denied/i.test(error.message)) return new Error('You don\'t have permission to do this. Ask the hospital owner if you need access.')
  if (c === 'PGRST116') return new Error('This record was not found or you are not allowed to change it. Refresh the page and try again.')
  if (c === '23514') return new Error(`Some values are not valid: ${error.message.replace(/^.*constraint "(.+?)".*$/, '$1').replace(/_/g, ' ')}`)
  return new Error(error.message)
}

let warnedTruncated = false

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
  async signUp({ full_name, email, password, phone, invite_token }) {
    // the role comes from handle_new_user(): an accepted staff invite, otherwise patient
    const { data, error } = await client().auth.signUp({ email, password, options: { data: { full_name, phone, ...(invite_token ? { invite_token } : {}) } } })
    if (error) throw new Error(error.message)
    if (!data.session) throw new Error('Account created! Please confirm your email, then sign in.')
    const p = await fetchProfile(data.user!.id)
    if (!p) throw new Error('Profile was not created. Check the handle_new_user trigger.')
    return p
  },
  async signOut() {
    await client().auth.signOut()
  },
  async changePassword(current, next) {
    const { data } = await client().auth.getUser()
    const email = data.user?.email
    if (!email) throw new Error('Not signed in')
    // re-authenticate first so a borrowed, unlocked session can't silently change the password
    const check = await client().auth.signInWithPassword({ email, password: current })
    if (check.error) throw new Error('Your current password is incorrect')
    const { error } = await client().auth.updateUser({ password: next })
    if (error) throw new Error(error.message)
  },
  async requestPasswordReset(email, redirectTo) {
    const { error } = await client().auth.resetPasswordForEmail(email.trim(), { redirectTo })
    // rate-limit errors are worth showing; "user not found" never is (Supabase doesn't reveal it anyway)
    if (error && /rate|seconds|too many/i.test(error.message)) throw new Error('Too many reset requests. Please wait a minute and try again.')
  },
  async hasRecoverySession() {
    // the client reads the tokens from the link (#access_token… or ?code=…) on load; give it a moment
    for (let i = 0; i < 20; i++) {
      const { data } = await client().auth.getSession()
      if (data.session) return true
      await new Promise((r) => setTimeout(r, 150))
    }
    return false
  },
  async setNewPassword(next) {
    const { error } = await client().auth.updateUser({ password: next })
    if (error) throw new Error(/different from the old/i.test(error.message) ? 'Choose a password different from your old one.' : error.message)
  },
  async signOutEverywhere() {
    await client().auth.signOut({ scope: 'global' })
  },
  async uploadAvatar(userId, file) {
    const path = `${userId}/avatar-${Date.now().toString(36)}.webp`
    const { error } = await client().storage.from('avatars').upload(path, file, { contentType: file.type || 'image/webp', upsert: true, cacheControl: '3600' })
    if (error) throw new Error(error.message.includes('Bucket not found') ? 'Storage bucket "avatars" is missing — re-run supabase/master.sql.' : error.message)
    return client().storage.from('avatars').getPublicUrl(path).data.publicUrl
  },
  onChange(cb) {
    const { data } = client().auth.onAuthStateChange(() => cb())
    return () => data.subscription.unsubscribe()
  },
}
