import type { DB, Profile, TableName } from '../types'
import { isSupabaseConfigured } from '../lib/supabase'
import { localAdapter } from './localAdapter'
import { supabaseAdapter } from './supabaseAdapter'

export type Row<T extends TableName> = DB[T]
export type NewRow<T extends TableName> = Omit<DB[T], 'id' | 'created_at' | 'updated_at'> & { id?: string }

export interface DataAdapter {
  mode: 'local' | 'supabase'
  list<T extends TableName>(table: T): Promise<Row<T>[]>
  insert<T extends TableName>(table: T, row: NewRow<T>): Promise<Row<T>>
  update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>): Promise<Row<T>>
  remove(table: TableName, id: string): Promise<void>
  reset?(): Promise<void>
}

export interface SignUpInput { full_name: string; email: string; password: string; phone?: string }

export interface AuthAdapter {
  getCurrent(): Promise<Profile | null>
  signIn(email: string, password: string): Promise<Profile>
  signUp(input: SignUpInput): Promise<Profile>
  signOut(): Promise<void>
  /** change the signed-in user's password (current password is re-checked) */
  changePassword(current: string, next: string): Promise<void>
  /** end every session of this user (all devices) */
  signOutEverywhere(): Promise<void>
  /** upload a profile photo and return its public URL */
  uploadAvatar(userId: string, file: Blob): Promise<string>
  onChange(cb: () => void): () => void
}

export const db: DataAdapter = isSupabaseConfigured ? supabaseAdapter : localAdapter
