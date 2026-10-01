import type { DB, Profile, TableName } from '../types'
import { isSupabaseConfigured } from '../lib/supabase'
import { localAdapter } from './localAdapter'
import { supabaseAdapter } from './supabaseAdapter'
import type { Query, QueryResult } from './query'

export type Row<T extends TableName> = DB[T]
export type NewRow<T extends TableName> = Omit<DB[T], 'id' | 'created_at' | 'updated_at'> & { id?: string }

export interface DataAdapter {
  mode: 'local' | 'supabase'
  list<T extends TableName>(table: T): Promise<Row<T>[]>
  /** filtered / searched / sorted / paged read — only the requested rows leave the database */
  query<T extends TableName>(table: T, q: Query): Promise<QueryResult<Row<T>>>
  insert<T extends TableName>(table: T, row: NewRow<T>): Promise<Row<T>>
  update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>): Promise<Row<T>>
  remove(table: TableName, id: string): Promise<void>
  reset?(): Promise<void>
}

export interface SignUpInput { full_name: string; email: string; password: string; phone?: string; invite_token?: string }
export type InviteInfo = { ok: true; email: string; full_name: string; role: Profile['role']; phone?: string | null } | { ok: false; error: string }

export interface AuthAdapter {
  getCurrent(): Promise<Profile | null>
  signIn(email: string, password: string): Promise<Profile>
  signUp(input: SignUpInput): Promise<Profile>
  signOut(): Promise<void>
  /** change the signed-in user's password (current password is re-checked) */
  changePassword(current: string, next: string): Promise<void>
  /** e-mail a password-reset link that opens `redirectTo` (always resolves, so it never reveals whether an account exists) */
  requestPasswordReset(email: string, redirectTo: string): Promise<void>
  /** whether this page was opened from a valid reset link (a recovery session exists) */
  hasRecoverySession(): Promise<boolean>
  /** set a new password inside a recovery session */
  setNewPassword(next: string): Promise<void>
  /** end every session of this user (all devices) */
  signOutEverywhere(): Promise<void>
  /** upload a profile photo and return its public URL */
  uploadAvatar(userId: string, file: Blob): Promise<string>
  onChange(cb: () => void): () => void
}

export const db: DataAdapter = isSupabaseConfigured ? supabaseAdapter : localAdapter

/** Reads every row of a bounded query (a date window, one patient's history…) page by page, up to `cap` rows. */
export async function queryAll<T extends TableName>(table: T, q: Query, cap = 20_000): Promise<Row<T>[]> {
  const out: Row<T>[] = []
  const PAGE = 1000
  for (let from = 0; from < cap; from += PAGE) {
    const { rows } = await db.query(table, { ...q, count: false, range: [from, Math.min(cap, from + PAGE) - 1] })
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}
