/**
 * Runs supabase/master.sql (or production.sql) inside PGlite with tiny stand-ins for the Supabase
 * pieces it relies on (auth.users, auth.uid(), storage, roles), so RLS + triggers + RPCs can be tested
 * without Docker or a real project.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const SUPABASE_STUBS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant anon, authenticated, service_role to current_user;
create schema extensions; create schema auth; create schema storage;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
create table auth.users (
  instance_id uuid, id uuid primary key default gen_random_uuid(), aud text, role text, email text unique,
  encrypted_password text, email_confirmed_at timestamptz, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}',
  created_at timestamptz default now(), updated_at timestamptz default now(), confirmation_token text, email_change text,
  email_change_token_new text, recovery_token text, banned_until timestamptz);
create table auth.identities (id uuid, user_id uuid references auth.users on delete cascade, provider_id text, identity_data jsonb,
  provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
`

export type Db = PGlite & {
  as<T = Record<string, unknown>>(who: string | null, sql: string, params?: unknown[]): Promise<T[]>
  one<T = Record<string, unknown>>(who: string | null, sql: string, params?: unknown[]): Promise<T>
}

export async function freshDb(file: 'master' | 'production' | { path: string } | { sql: string } = 'master'): Promise<Db> {
  const db = (await PGlite.create({ extensions: { pgcrypto } })) as Db
  await db.exec(SUPABASE_STUBS)
  await db.exec('create extension if not exists pgcrypto with schema extensions;')
  await db.exec(typeof file === 'object' && 'sql' in file ? file.sql : readFileSync(typeof file === 'string' ? resolve(__dirname, `../../supabase/${file}.sql`) : file.path, 'utf8'))
  /** run a query as a signed-in user id, 'anon', 'service' or null (superuser) */
  db.as = async (who, sql, params = []) => {
    await db.exec('reset role; select set_config(\'request.jwt.claim.sub\', \'\', false);')
    if (who === 'anon') await db.exec('set role anon')
    else if (who === 'service') await db.exec('set role service_role')
    else if (who) await db.exec(`select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;`)
    try {
      return (await db.query(sql, params)).rows as never
    } finally {
      await db.exec('reset role')
    }
  }
  db.one = async (who, sql, params) => (await db.as(who, sql, params))[0] as never
  return db
}

export const USER = {
  owner: 'd0c00000-0000-4000-8000-000000000001',
  doctor: 'd0c00000-0000-4000-8000-000000000002',
  receptionist: 'd0c00000-0000-4000-8000-000000000003',
  accountant: 'd0c00000-0000-4000-8000-000000000004',
  staff: 'd0c00000-0000-4000-8000-000000000005',
  patient: 'd0c00000-0000-4000-8000-000000000006',
}
